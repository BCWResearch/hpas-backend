// src/routes/partner.ts
import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient, AccountType, PartnerUserRole, Prisma, PartnerUserStatus } from "@prisma/client";
import crypto from "crypto";
import { issueApiKey, revealApiKey } from "../utils/apiKey";
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local"; // swap to GCP in prod
import { requirePartnerAuthentication } from "../middleware/partnerAuth";
import { requireSecure } from "../middleware/secureGate";
import { fetchPartnerBalanceInUsdAndHbarFromApi } from "../utils/balance/balanceUtil";
import { checkRole } from "../utils/checkRole";
import { getHederaClient } from "../utils/getHederaClient";
import { AccountBalanceQuery, AccountUpdateTransaction, Client, Hbar, HbarUnit, PrivateKey, TransactionId, TransactionReceiptQuery } from "@hashgraph/sdk";
import { sendEmail } from "../utils/email/email";
import { getPartnerKeyFromKMS } from "./api";
import { fetchUsdPerHbar } from "../utils/balance/drip/getDripAndFees";

const kmsAdapter =
  process.env.KEY_ENV === "gcp"
    ? makeGcpKmsAdapter()
    : makeLocalKmsAdapter();
const prisma = new PrismaClient();
const router = Router();
const kms =
  process.env.KEY_ENV === "gcp"
    ? makeGcpKmsAdapter()
    : makeLocalKmsAdapter();

/** Attach req.auth from your JWT/session middleware after /auth/verify */
type AuthCtx = { partnerId: string; memberId: string; stepUpAt?: Date };
declare global {
  namespace Express {
    interface Request { auth?: AuthCtx }
  }
}

/** Require recent step-up (fresh signature) within N minutes before sensitive ops */
const requireRecentStepUp = (minutes = 5) => (req: Request, res: Response, next: NextFunction) => {
  const stepUp =
    (req as any).auth?.stepUpAt ??
    (req as any).secureClaims?.stepUpAt; // <— read from secure as fallback
  const ts = stepUp instanceof Date ? stepUp.getTime() : Number(stepUp || 0);
  if (!ts) return res.status(401).json({ error: "Step-up required" });
  if (Date.now() - ts >= minutes * 60 * 1000)
    return res.status(401).json({ error: "Step-up expired" });
  next();
};


// --- helpers (reuse if you already have them elsewhere) ---
const isEvm = (s: string) => /^0x[0-9a-fA-F]{40}$/.test((s ?? "").trim());
const isHedera = (s: string) => /^\d+\.\d+\.\d+$/.test((s ?? "").trim());
const normalizeAccountId = (raw?: string) => {
  const t = (raw ?? "").trim();
  if (isEvm(t)) return { evm: t.toLowerCase(), hedera: null as string | null, type: 'EVM' as AccountType };
  if (isHedera(t)) return { evm: null as string | null, hedera: t };
  return { evm: null as string | null, hedera: null as string | null, type: 'HEDERA' as AccountType };
};

function getRangeStart(range: string) {
  switch (range) {
    case '7d': return '7 days'
    case '90d': return '90 days'
    default: return '30 days'
  }
}

export function generateVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}


export async function sendVerificationEmail(email: string, token: string, name: string) {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  const html = `
      <p>You were added as an email identity for ${name}'s HDrip account.</p>
      <p>Please verify your email by clicking the link below:</p>
      <a href="${verifyUrl}">Verify Email</a>
      <p>This link expires in 24 hours.</p>
    `;

  await sendEmail(
    email,
    "Verify your email",
    html);
}

async function sendRefillEmail(
  partnerEmails: string[],
  hbars: string,
  thresholdHbar: number
) {

  const subject = "Faucet Balance Refill Alert";

  const html = `
    <p>
      Your organization's Faucet account balance has been refilled. 
      Current balance: ${hbars} hbar
      threshold: ${thresholdHbar} hbar
    </p>
    <p>
      Note: If the current balance is below threshold, you may still receive low balance alerts.
    </p>
  `;

  await sendEmail(partnerEmails, subject, html);
}


router.post("/rotate-account", requirePartnerAuthentication, async (req, res) => {
  const { partnerId, role } = (req as any).user;

  if (!checkRole(role, [PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: "UNAUTHORIZED" });
  }

  const partner = await prisma.apiPartner.findFirst({ where: { id: partnerId } });
  if (!partner) return res.status(404).json({ code: "PARTNER_NOT_FOUND" });

  // Get current key from KMS so we can sign the update
  const { sender_account_pkey } = await getPartnerKeyFromKMS(partner.accountId);

  const client = Client.forMainnet();
  client.setOperator(partner.accountId, sender_account_pkey);

  // Generate next keypair
  const newPrivateKey = PrivateKey.generateECDSA();
  const newPublicKey = newPrivateKey.publicKey;

  // Wrap first so KMS failure doesn't happen after we rotate
  let encryptedPrivateKey: Buffer;
  try {
    encryptedPrivateKey = await kmsAdapter.wrap(Buffer.from(newPrivateKey.toBytes()));
  } catch (e) {
    return res.status(500).json({ code: "KMS_WRAP_FAILED" });
  }

  // Rotate on-chain
  const tx = new AccountUpdateTransaction()
    .setAccountId(partner.accountId)
    .setKey(newPublicKey);



  const frozen = tx.freezeWith(client);

  const signed = await (await frozen.sign(sender_account_pkey)).sign(newPrivateKey);
  const txResponse = await signed.execute(client);
  const receipt = await txResponse.getReceipt(client);

  const status = receipt.status.toString();
  if (status !== "SUCCESS") {
    return res.status(500).json({ code: "ROTATION_FAILED", status });
  }

  // Persist in DB
  const updatedPartner = await prisma.apiPartner.update({
    where: { id: partnerId },
    data: {
      encryptedPrivateKey,
      publicKey: newPublicKey.toStringDer(),
      // don't reset unrelated fields unless you intend to
    },
  });

  await prisma.apiKey.updateMany({
    where: {
      apiPartnerId: partnerId,
      env: "LIVE",
    },
    data: {
      revoked: true,
    },
  });
  // Create a new API Key, and issue it here (TODO)
  await issueApiKey(prisma, kmsAdapter, {
    apiPartnerId: updatedPartner.id,
    env: "LIVE",
    type: "FAUCET",
    scopes: ["faucet:drip", "passport:score", "faucet:transactions"],
  });


  return res.status(200).json({ code: 'OK' });
});


router.post('/threshold', requirePartnerAuthentication, async (req, res) => {
  const { partnerId, role } = (req as any).user;
  const { threshold } = req.body;
  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) { return res.status(401).json({ code: 'UNAUTHORIZED' }) }
  const thres = await prisma.apiPartner.update({
    where: { id: partnerId }, data: { threshold, thresholdTriggered: false },
  });
  if (!thres) { return res.status(500).json({ code: 'THRESHOLD AMOUNT UPDATE FAILED' }) }
  return res.status(200).json({ threshold });
});


router.post('/drip-amount', requirePartnerAuthentication, async (req, res) => {
  const { partnerId, role } = (req as any).user;
  const { dripAmountInUsd } = req.body;
  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) { return res.status(401).json({ code: 'UNAUTHORIZED' }) }
  const drip = await prisma.apiPartner.update({
    where: { id: partnerId }, data: { dripAmountInUsd },
  });
  if (!drip) { return res.status(500).json({ code: 'DRIP AMOUNT UPDATE FAILED' }) }
  return res.status(200).json({ dripAmountInUsd });
})

// crud for email system
router.get('/emails', requirePartnerAuthentication, async (req, res) => {
  const { role, partnerId } = (req as any).user;

  if (!checkRole(role, [PartnerUserRole.OWNER, PartnerUserRole.ADMIN])) {
    return res.status(401).json({ code: 'UNAUTHORIZED' });
  }

  const partner = await prisma.apiPartner.findUnique({
    where: { id: partnerId },
    select: { emails: true },
  });

  if (!partner) {
    return res.status(404).json({ code: 'PARTNER_NOT_FOUND' });
  }

  return res.status(200).json({
    emails: partner.emails,
  });
});

router.post("/add-email", requirePartnerAuthentication, async (req, res) => {
  const { partnerId, role } = (req as any).user;
  const { emails } = req.body;

  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: "UNAUTHORIZED" });
  }
  const partner = await prisma.apiPartner.findFirst({ where: { id: partnerId }, select: { name: true } })
  for (const email of emails) {
    const created = await prisma.email.create({
      data: {
        email,
        partnerId,
        verified: false,
      },
    });

    const token = generateVerificationToken();

    await prisma.emailVerification.create({
      data: {
        emailId: created.id,
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });

    await sendVerificationEmail(email, token, partner?.name!);
  }

  return res.status(200).json({ success: true });
});
router.delete("/remove-email/:id", requirePartnerAuthentication, async (req, res) => {
  const { partnerId, role } = (req as any).user;
  const { id } = req.params;

  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: "UNAUTHORIZED" });
  }
  const partner = await prisma.apiPartner.findFirst({ where: { id: partnerId }, select: { name: true } })
  const created = await prisma.email.delete({
    where: { id }
  });

  return res.status(200).json({ success: true });
});

router.get("/verify-email", async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).send("Invalid token");
  }

  const record = await prisma.emailVerification.findUnique({
    where: { token },
    include: { email: true },
  });
  console.log(record);
  if (!record || record.expiresAt < new Date()) {
    return res.status(400).send("Token expired or invalid");
  }

  await prisma.$transaction([
    prisma.email.update({
      where: { id: record.emailId },
      data: { verified: true },
    }),
    prisma.emailVerification.delete({
      where: { id: record.id },
    }),
  ]);

  return res.status(200).json({ success: true });
});


router.get('/analytics', requirePartnerAuthentication, async (req, res) => {
  const { partnerId } = (req as any).user;
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
    0, 0, 0, 0
  ));
  const [allTime, thisMonth] = await Promise.all([
    prisma.partnerTransactionHistory.aggregate({
      where: {
        partnerId,
        status: "SUCCESS",
      },
      _count: { _all: true },
      _sum: { amountTinybar: true },
    }),

    prisma.partnerTransactionHistory.aggregate({
      where: {
        partnerId,
        status: "SUCCESS",
        timestamp: {
          gte: startOfMonth,
        },
      },
      _count: { _all: true },
      _sum: { amountTinybar: true },
    }),
  ]);

  const TINYBAR_PER_HBAR = 100_000_000n;

  const totalTinybar = allTime._sum.amountTinybar ?? 0n;
  const totalHbar = Number(totalTinybar) / Number(TINYBAR_PER_HBAR);

  const usdPerHbar = await fetchUsdPerHbar(); // cache this
  const totalUsd = totalHbar * usdPerHbar;

  const totalDrips = allTime._count._all;

  const monthlyTinybar = thisMonth._sum.amountTinybar ?? 0n;
  const monthHbar = Number(monthlyTinybar) / Number(TINYBAR_PER_HBAR);
  const monthUSD = monthHbar * usdPerHbar;
  const monthDrips = thisMonth._count._all
  return res.status(200).json({
    totalDrips,
    totalUsdDripped: Number(totalUsd.toFixed(2)),
    monthDrips,
    monthUSDDripped: Number(monthUSD.toFixed(2))
  });
});

router.post('/balance', requirePartnerAuthentication, async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) { return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND' }) }
  const { hbar_balance, usd_balance } = await fetchPartnerBalanceInUsdAndHbarFromApi(accountId);
  return res.status(200).json({ balance: { hbar_balance, usd_balance } });
});

router.get('/dashboard', requirePartnerAuthentication, async (req, res) => {
  // need to return current account balance, account id, data for a usage graph, 
  const { partnerId } = (req as any).user;

  const partner = await prisma.apiPartner.findFirst({
    where: {
      id: partnerId,
    }
  });
  if (!partner) { return res.status(404).json({ code: 'PARTNER_NOT_FOUND' }) }
  const { hbar_balance, usd_balance } = await fetchPartnerBalanceInUsdAndHbarFromApi(partner.accountId);


  return res.status(200).json({
    partner: {
      partner_id: partner.id,
      partner_name: partner.name,
      partner_account_id: partner.accountId,
      partner_usd_balance: usd_balance,
      partner_hbar_balance: hbar_balance,
      partner_threshold: partner.threshold,
      partner_drip_amount_in_usd: partner.dripAmountInUsd,
      active: partner.active,
    }
  });
});

/*
router.get('/refill-account/:transactionId', requirePartnerAuthentication, async (req, res) => {
  // get the account id from BE transaction id 
  const { partnerId } = (req as any).user;
  const { transactionId } = req.params;
      if (!partnerId) {
      return res.status(400).json({ code: "MISSING_REQUIRED_FIELDS" });
    }

       try {
      const partner = await prisma.apiPartner.findUnique({
        where: { id: partnerId },
        select: {
          accountId: true,
          threshold: true,
          thresholdTriggered: true,
        },
      });

      if (!partner) {
        return res.status(404).json({ code: "PARTNER_NOT_FOUND" });
      }

      const client = Client.forMainnet();

      const balance = await new AccountBalanceQuery()
        .setAccountId(partner.accountId)
        .execute(client);

      const balanceTinybar = balance.hbars.toTinybars();
      const thresholdTinybar = Hbar.fromString(
        partner.threshold.toString(),
        HbarUnit.Hbar
      ).toTinybars();

      let thresholdReset = false;

      if (
        partner.thresholdTriggered &&
        balanceTinybar.greaterThanOrEqual(thresholdTinybar)
      ) {
        await prisma.apiPartner.update({
          where: { id: partnerId },
          data: { thresholdTriggered: false },
        });

        thresholdReset = true;
      }

      if (thresholdReset) {
        const emails = await prisma.email.findMany({
          where: {
            partnerId: partnerId,
            verified: true,
          },
          select: { email: true },
        });

        if (emails.length > 0) {
          try {
            await sendRefillSuccessEmail(
              emails.map(e => e.email),
              balance.hbars,
              partner.threshold,
            );
          } catch (err) {
            console.error("Refill email failed", err);
          }
        }
      }

      // 5️⃣ Optional: audit log
      await logApiRequest(
        partner_id,
        null,
        "refill-account",
        200,
        thresholdReset ? "THRESHOLD_RESET" : "NO_THRESHOLD_CHANGE",
        0,
        req.ip!,
        true
      );

      return res.status(200).json({
        code: "REFILL_PROCESSED",
        thresholdReset,
        currentBalance: balance.hbars.toString(),
        refill_tx_id,
      });
    } catch (err) {
      console.error(err);

      return res.status(500).json({
        code: "REFILL_INTERNAL_ERROR",
      });
    }

});
*/
router.post("/pause", requirePartnerAuthentication, async (req, res) => {
  const { faucet_paused } = req.body as { faucet_paused: boolean };
  const { partnerId, role } = (req as any).user;

  if (!checkRole(role, [PartnerUserRole.OWNER, PartnerUserRole.ADMIN])) {
    return res.status(403).json({ code: "USER_DENIED" });
  }

  await prisma.apiPartner.update({
    where: { id: partnerId },
    // active = !paused
    data: { active: !faucet_paused },
  });

  return res.status(200).json({ faucet_paused });
});


router.get("/pause", requirePartnerAuthentication, async (req, res) => {
  const { partnerId, role } = (req as any).user;

  if (!checkRole(role, [PartnerUserRole.OWNER, PartnerUserRole.ADMIN])) {
    return res.status(403).json({ code: "USER_DENIED" });
  }

  const lockState = await prisma.apiPartner.findFirst({
    where: { id: partnerId },
    select: { active: true },
  });

  if (!lockState) {
    return res.status(404).json({ code: "NO_LOCK", message: "No Lock State found" });
  }

  // paused = !active
  return res.status(200).json({ faucet_paused: !lockState.active });
});


router.post("/confirm", requirePartnerAuthentication, async (req, res) => {
  console.log('REQ BODY:', req.body);
  const { partnerId } = (req as any).user;
  const { transactionId } = req.body;
  if (!transactionId) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const client = getHederaClient('mainnet');
  try {
    const receipt = await new TransactionReceiptQuery()
      .setTransactionId(TransactionId.fromString(transactionId))
      .execute(client)

    if (receipt.status?.toString() !== "SUCCESS") {
      return res.status(409).json({
        error: "Transaction failed",
        status: receipt.status?.toString(),
      });
    }

    // Send an Email to Faucet Team
    const email_list = await prisma.email.findMany({
      where: {
        partnerId: partnerId,
        verified: true
      },
      select: {
        email: true,
      }
    });
    if (!email_list) {
      return res.status(404).json({ code: 'EMAIL_LIST_NOT_FOUND' })
    }
    const emails = email_list.map(e => e.email);

    const update_trigger = await prisma.apiPartner.update({
      where: { id: partnerId },
      data: { thresholdTriggered: false },
      select: { accountId: true, threshold: true }
    });
    if (!update_trigger) {
      return res.status(404).json({ code: 'TRIGGER_NOT_FOUND' })
    }
    const { hbar_balance } = await fetchPartnerBalanceInUsdAndHbarFromApi(update_trigger.accountId);
    await sendRefillEmail(emails, hbar_balance, update_trigger.threshold);

    return res.json({
      status: "FINALIZED",
      transactionId,
      confirmedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Tx confirmation failed:", err);

    return res.status(500).json({
      error: "Unable to confirm transaction",
    });
  }
});

router.get("/transactions", requirePartnerAuthentication, async (req, res) => {
  const { partnerId } = (req as any).user;

  const transactions = await prisma.partnerTransactionHistory.findMany({
    where: {
      partnerId,
    },
    orderBy: {
      timestamp: 'desc',
    },
  });
  if (!transactions) {
    return res.status(404).json({ code: 'TRANSACTIONS_NOT_FOUND' });
  }

  const safeTransactions = transactions.map(tx => ({
    ...tx,
    amountTinybar: Hbar.fromString(tx.amountTinybar.toString(), HbarUnit.Tinybar).toString(), // BigInt → string
    timestamp: tx.timestamp.toISOString(),      // Date → string
  }));

  return res.status(200).json({ transactions: safeTransactions });
});

router.get('/insights/requests', requirePartnerAuthentication, async (req, res) => {
  const { partnerId } = (req as any).user;
  const range = (req.query.range as string) ?? '30d'
  const interval = getRangeStart(range)

  const data = await prisma.$queryRaw<
    {
      day: string
      success: number
      failed: number
      rate_limited: number
    }[]
  >`
SELECT
  to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
  COUNT(*) FILTER (WHERE "statusCode" BETWEEN 200 AND 299)::int AS success,
  COUNT(*) FILTER (
    WHERE "statusCode" >= 400
      AND "statusCode" != 429
  )::int AS failed,
  COUNT(*) FILTER (WHERE "statusCode" = 429)::int AS rate_limited
FROM "ApiRequestLog"
WHERE "apiPartnerId" = ${partnerId}
  AND timestamp >= NOW() - INTERVAL ${Prisma.raw(`'${interval}'`)}
GROUP BY day
ORDER BY day ASC;

`


  res.json(data)
}
);

router.get('/insights/requests/yearly', requirePartnerAuthentication, async (req, res) => {
  const { partnerId } = (req as any).user;

  const data = await prisma.$queryRaw<
    {
      month: string
      success: number
      failed: number
      rate_limited: number
    }[]
  >`
SELECT
  to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
  COUNT(*) FILTER (WHERE "statusCode" BETWEEN 200 AND 299)::int AS success,
  COUNT(*) FILTER (WHERE "statusCode" = 429)::int AS rate_limited,
  COUNT(*) FILTER (
    WHERE "statusCode" >= 400
      AND "statusCode" != 429
  )::int AS failed
FROM "ApiRequestLog"
WHERE "apiPartnerId" = ${partnerId}
GROUP BY month
ORDER BY month ASC;
`;

  res.json(data);
});

router.delete('/remove-user', requirePartnerAuthentication, async (req, res) => {
  const { role } = (req as any).user;
  if (!checkRole(role, [PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: 'USER_DENIED' });
  }
  const { userId } = req.body;
  const removeUser = await prisma.apiPartnerUser.delete({
    where: { id: userId }
  });
  if (!removeUser) return res.status(500).json({ code: 'REMOVE_USER_FAILED' });
  return res.status(200).json({ success: true });
})

router.post('/add-user-to-partner', requirePartnerAuthentication, async (req, res) => {
  const { accountId, role } = req.body;


  const { userId: reqUserId, partnerId: reqPartnerId, role: reqUserRole } = (req as any).user;
  if (!checkRole(reqUserRole, [PartnerUserRole.OWNER, PartnerUserRole.ADMIN])) {
    return res.status(401).json({ code: 'USER_DENIED' });
  }
  // Check if partner belongs to org already:
  const partner = await prisma.apiPartner.findUnique({ where: { id: reqPartnerId } });
  const checkAvailability = await prisma.apiPartnerUser.findFirst({
    where: {
      accountId,
    }
  });
  if (checkAvailability) {
    return res.status(401).json({ code: 'USER_ALREADY_EXISTS' });
  } else {
    const user = await prisma.apiPartnerUser.create({
      data: {
        partnerId: reqPartnerId,
        accountId,
        role,
        status: PartnerUserStatus.INVITED,
      }
    });
    if (!user) {
      return res.status(500).json({ code: 'Error adding user to org' });
    }
    // send email to invite user to org (TODO)
    /*
            const subject = `Welcome to ${partner!.name}'s Faucet Team!`;
            const html = `
        <div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
          <h2>Hello ${email}</h2>
          <p>
          You have been invited to ${partner!.name}'s Faucet API Team. You can use the following link to sign in:
        
          </p>
    
          <h3>EVM Accounts That Received Drips within the past 24 hours:</h3>
        </div>
      `;
    
            await sendEmail(email, subject, html);
            */
    return res.status(200).json({ ok: true });
  }
}
);

router.post("/update-user", requirePartnerAuthentication, async (req, res) => {
  const { requested_role, requested_user_id } = req.body;
  const { role: actorRole, user_id: actorUserId, partner_id } = (req as any).user;

  // 1) Basic allowlist: only ADMIN/VIEWER assignable from partner portal
  const assignableRoles = [PartnerUserRole.ADMIN, PartnerUserRole.VIEWER];
  if (!assignableRoles.includes(requested_role)) {
    return res.status(400).json({ code: "ROLE_NOT_ASSIGNABLE" });
  }

  // 2) Fetch target user (and make sure same org)
  const target = await prisma.apiPartnerUser.findFirst({
    where: { id: requested_user_id, partnerId: partner_id },
    select: { id: true, role: true },
  });

  if (!target) return res.status(404).json({ code: "USER_NOT_FOUND" });

  // 3) Prevent self-demotion (optional but recommended)
  if (target.id === actorUserId) {
    return res.status(400).json({ code: "CANNOT_CHANGE_SELF_ROLE" });
  }

  const isOwner = checkRole(actorRole, [PartnerUserRole.OWNER]);
  const isAdmin = checkRole(actorRole, [PartnerUserRole.ADMIN]);

  // 4) Authorization rules
  const canEdit =
    isOwner ||
    (isAdmin &&
      checkRole(target.role, [PartnerUserRole.ADMIN, PartnerUserRole.VIEWER]) &&
      checkRole(requested_role, [PartnerUserRole.ADMIN, PartnerUserRole.VIEWER]));

  if (!canEdit) return res.status(401).json({ code: "USER_DENIED" });
  const update_user_role = await prisma.apiPartnerUser.update({
    where: {
      id: target.id
    },
    data: {
      role: requested_role
    }
  });
  if (!update_user_role) {
    return res.status(500).json({ code: 'FAILED_TO_UPDATE' });
  }
  return res.status(200).json({ code: 'OK' });
});

router.post('/pause-user', requirePartnerAuthentication, async (req, res) => {
  const { role, partnerId } = (req as any).user;
  const { userId } = req.body;
  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: "CANNOT_FETCH_USERS" });
  }
  const pause_user = await prisma.apiPartnerUser.update({
    where: { id: userId },
    data: { status: PartnerUserStatus.PAUSED }
  });
  if (!pause_user) { return res.status(401).json({ code: 'PAUSE_FAILED ' }) }

  return res.status(200).json({
    paused: true,
  });
});

router.post('/resume-user', requirePartnerAuthentication, async (req, res) => {
  const { role, partnerId } = (req as any).user;
  const { userId } = req.body;
  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: "CANNOT_FETCH_USERS" });
  }
  const resume_user = await prisma.apiPartnerUser.update({
    where: { id: userId },
    data: { status: PartnerUserStatus.ACTIVE }
  });
  if (!resume_user) { return res.status(401).json({ code: 'RESUME_FAILED ' }) }

  return res.status(200).json({
    resume: true,
  });
});

router.get("/users", requirePartnerAuthentication, async (req, res) => {
  const { role, partnerId } = (req as any).user;

  if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) {
    return res.status(401).json({ code: "CANNOT_FETCH_USERS" });
  }

  const partner = await prisma.apiPartner.findUnique({
    where: { id: partnerId },
    select: { users: true },
  });

  return res.status(200).json({
    users: partner?.users ?? [],
  });
}
);


// List keys (no plaintext). You can require auth here (recommended).
router.get("/key", requirePartnerAuthentication, async (req, res) => {
  const { partnerId } = (req as any).user;
  const k = await prisma.apiKey.findFirst({
    where: { apiPartnerId: partnerId, revoked: false },
    orderBy: { createdAt: "desc" },
    include: { scopes: true },
  });
  if (!k) { return res.status(404).json({ code: 'KEY_NOT_FOUND' }) }
  res.json({
    key: {
      id: k.id,
      prefix: k.prefix,
      env: k.env,
      type: k.type,
      scopes: k.scopes.map(s => s.scope),
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      redacted: `pk_${k.env.toLowerCase()}_${k.type.toLowerCase()}_${k.prefix}_•••••••••`,
    }
  }
  )
});


// Secure reveal — requires fresh step-up (<= 5 min old)
router.get("/keys/:id/reveal",
  requirePartnerAuthentication,
  requireSecure(),
  async (req, res) => {
    const { partnerId } = (req as any).auth;
    const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!key || key.apiPartnerId !== partnerId) return res.status(404).json({ error: "Not found" });
    if (key.revoked) return res.status(400).json({ error: "Key revoked" });

    const plaintext = await revealApiKey(prisma, kms, key.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ plaintext });
  }
);

// Regenerate — revoke current + mint new; requires fresh step-up
router.get("/keys/:id/regenerate",
  requirePartnerAuthentication,
  requireSecure(),
  async (req, res) => {
    const { partnerId, role } = (req as any).user;
    if (!checkRole(role, [PartnerUserRole.ADMIN, PartnerUserRole.OWNER])) { return res.status(401).json({ code: 'UNAUTHORIZED' }) }
    const cur = await prisma.apiKey.findUnique({ where: { id: req.params.id }, include: { scopes: true } });
    if (!cur || cur.apiPartnerId !== partnerId) return res.status(404).json({ error: "Not found" });

    await prisma.apiKey.update({ where: { id: cur.id }, data: { revoked: true } });

    const newKey = await issueApiKey(prisma, kms, {
      apiPartnerId: partnerId,
      env: cur.env as any,
      type: cur.type as any,
      scopes: ["faucet:drip", "passport:score", "faucet:transactions"],
      expiresAt: cur.expiresAt ?? null,
    });

    res.status(201).json({ key: newKey.plaintext }); // includes plaintext once
  }
);

export default router;