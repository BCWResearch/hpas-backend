import { Router, Request, Response } from "express";
import { PrismaClient, AccountType } from "@prisma/client";
import { issueApiKey } from "../utils/apiKey"; // optional if you want to mint a key here
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import crypto from "crypto";
import { getHederaClient } from "../utils/getHederaClient";
import { getAddress, verifyMessage } from "ethers";
import { signSessionToken, verifySessionToken } from "../utils/jwt";
import { requireAdminAuth, requireAdminAuthentication } from "../middleware/adminAuth";
import { AccountCreateTransaction, Hbar, PrivateKey } from "@hashgraph/sdk";
import { sendEmail } from "../utils/email/email";

const router = Router();
const prisma = new PrismaClient();
const kmsAdapter =
    process.env.KEY_ENV === "gcp"
        ? makeGcpKmsAdapter()
        : makeLocalKmsAdapter();

const isEvm = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
const isHedera = (s: string) => /^\d+\.\d+\.\d+$/.test(s.trim());

const normalize = (raw: string) => {
    const t = (raw ?? "").trim();
    if (isEvm(t)) {
        // canonical: lowercase with 0x
        return { evm: t.toLowerCase(), hedera: null as string | null, kind: 'EVM' as AccountType };
    }
    if (isHedera(t)) {
        // canonical: keep as-is (Hedera IDs are numeric dotted)
        return { evm: null as string | null, hedera: t, kind: 'HEDERA' as AccountType };
    }
    return { evm: null as string | null, hedera: null as string | null, kind: null };
};


// PARTNER CRUD OPS

/** C
 * POST /add-new-partner
 * Admin-only route: creates a new Partner record.
 * (Authentication/authorization middleware should wrap this router.)
 * 
 * TODO: Add scope declarations to the FE so we can configure access to individual routes?
 * 
 */



router.post('/add-new-partner', async (req, res) => {
    // checks to see if we can create a new partner
    // need some sort of access key so only admin account can do this
    const { name, threshold, dripAmountInUsd } = req.body;

    const checkAvailability = await prisma.apiPartner.findUnique({
        where: {
            name
        }
    });

    if (checkAvailability) {
        return res.status(401).json({ code: 'USER_EXISTS' });
    }
    // create a new partner account:

    // create client
    const client = getHederaClient('mainnet');

    // create new pvt/public keypair:
    const newPrivateKey = PrivateKey.generateECDSA();
    const newPublicKey = newPrivateKey.publicKey;



    const transaction = new AccountCreateTransaction()
        .setECDSAKeyWithAlias(newPublicKey)
        .setInitialBalance(new Hbar(0.25));

    const txResponse = await transaction.execute(client);
    const receipt = await txResponse.getReceipt(client);
    const newAccountId = receipt.accountId;


    //TODO: encrypt private key with kms, public + encrypted pvt key will go to db,
    const encryptedPrivateKey = await kmsAdapter.wrap(
        Buffer.from(newPrivateKey.toBytes())
    );

    if (newAccountId) {

        // update or insert new api User

        // Public Key, partner name, partner email, threshold, role goes here.
        const partner = await prisma.apiPartner.create({
            data: {
                name,
                threshold,
                encryptedPrivateKey,
                dripAmountInUsd,
                publicKey: newPublicKey.toStringDer(),
                thresholdTriggered: false,
                accountId: newAccountId.toString(),
            }
        });

        if (partner) {

            console.log('Heres the partner id:', partner.id);

            // Create a new API Key, and issue it here (TODO)
            const apiKey = await issueApiKey(prisma, kmsAdapter, {
                apiPartnerId: partner.id,
                env: "LIVE",
                type: "FAUCET",
                scopes: ["faucet:drip", "passport:score", "faucet:transactions"],
            });
            return res.status(200).json({ code: 'OK' });
        }
    }
});

// R

// U
router.post("/partners/:id", requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;
    const { name, threshold, dripAmountInUsd, active } = req.body;

    console.log("🧩 PARAM ID:", id);
    console.log("🧩 BODY:", req.body);

    const updated_partner = await prisma.apiPartner.update({
        where: { id },
        data: {
            name,
            threshold,
            dripAmountInUsd,
            active,
        },
    });

    console.log("🧩 UPDATED RESULT:", updated_partner);

    return res.json({ partner: updated_partner });
});

// a method to rotate account keys automatically
router.post('/rotate/:id', requireAdminAuthentication, async (req, res) => {

});

// D

router.get('/pause/:id', requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;
    const partner = await prisma.apiPartner.findFirst({
        where: { id },
        select: { active: true }
    });

    if (!partner) { return res.status(404).json({ code: 'PARTNER_NOT_FOUND' }) }

    const changed_partner = await prisma.apiPartner.update({
        where: { id },
        data: { active: !partner.active }
    });

    return res.status(200).json({ partner: changed_partner });
});
/*
router.delete('/partners/:id', requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;

    const partner = await prisma.apiPartner.delete({
        where: { id },
    });
    if (!partner) { return res.status(403).json({ code: 'DELETE_FAILED' }) }
    return res.status(200).json({ partner });

})
*/

// USER CRUD OPS
router.post('/invite-user-to-partner', requireAdminAuthentication, async (req, res) => {
    const { partnerId, email, role } = req.body;

    // Check if partner belongs to org already:
    const partner = await prisma.apiPartner.findUnique({ where: { id: partnerId } });
    const checkAvailability = await prisma.apiPartnerUser.findFirst({
        where: {
            email,
        }
    });
    if (checkAvailability) {
        return res.status(401).json({ code: 'USER_ALREADY_EXISTS' });
    } else {
        const user = await prisma.apiPartnerUser.create({
            data: {
                partnerId,
                email,
                role,
                status: 'INVITED'
            }
        });
        if (!user) {
            return res.status(500).json({ code: 'Error adding user to org' });
        }
        // send email to invite user to org (TODO)

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
        return res.status(200).json({ ok: true });
    }
}
);

/*

router.post(
    "/add-new-partner-1",
    requireAdminAuth,
    async (req: Request, res: Response): Promise<any> => {
        try {
            // 1. Parse input
            const { name, contact, tier, requestLimitOverride, accounts, multiDrip } = req.body;

            if (!name) {
                return res.status(400).json({ error: "Partner name is required" });
            }

            // 2. Create Partner (inside transaction for atomicity)
            const result = await prisma.$transaction(async (tx) => {
                const partner = await tx.partner.create({
                    data: {
                        name,
                        contact: contact ?? null,
                        tier: tier ?? "BASIC",
                        multiDrip: multiDrip,
                        requestLimitOverride: requestLimitOverride ?? null,
                    },
                });

                let createdAccounts: PartnerAccount[] = [];
                if (Array.isArray(accounts) && accounts.length > 0) {
                    createdAccounts = await Promise.all(
                        accounts.map((a: any) =>
                            tx.partnerAccount.create({
                                data: {
                                    partnerId: partner.id,
                                    type: a.type, // "EVM" | "HEDERA"
                                    accountId: a.accountId,
                                    network: a.network ?? "MAINNET",
                                    chainId: a.type === "EVM" ? a.chainId ?? 1 : null,
                                    role: a.role ?? "OWNER",
                                    isLoginIdentity: a.isLoginIdentity ?? false,
                                },
                            })
                        )
                    );
                }

                // 4. Mint an API key here if you want admin-created keys
                // In prod this will use a GCP KMS Adapter, for local must set up some sort of local KMS adapter
                const apiKey = await issueApiKey(tx, kmsAdapter, {
                    partnerId: partner.id,
                    env: "LIVE",
                    type: "FAUCET",
                    scopes: ["faucet:drip", "passport:score", "faucet:transactions"],
                });

                return { partner, accounts: createdAccounts };
            });

            // 5. Respond
            return res.status(201).json({
                message: "Partner created successfully",
                partner: result.partner,
                accounts: result.accounts,
                // apiKey: result.apiKey, // only include if you mint keys here
            });
        } catch (err) {
            console.error("Failed to add partner:", err);
            return res.status(500).json({ error: "Internal Server Error" });
        }
    }
);

*/


// Will need a new sign in procedure for admins (BCW Entities ONLY)

// Will need a similar thing for partners

/*
router.post("/auth/nonce", async (req: Request, res: Response) => {
    const { accountId } = req.body ?? {};
    if (!accountId) return res.status(400).json({ error: "Missing wallet" });

    const { evm, hedera, kind } = normalize(accountId);
    // Optional: early reject obviously bad inputs
    if (!evm && !hedera || !kind) {
        return res.status(400).json({ error: "Invalid wallet format" });
    }
    // Try to match admin by either field (case-insensitive for EVM)
    const admin = await prisma.adminAccount.findFirst({
        where: {
            OR: [
                evm ? { walletEvm: { equals: evm, mode: "insensitive" } } : undefined,
                hedera ? { walletHedera: { equals: hedera, mode: "insensitive" } } : undefined,
            ].filter(Boolean) as any,
        },
        select: { id: true, walletEvm: true, walletHedera: true },
    });

    if (!admin) {
        // TEMP diagnostics—remove in prod
        console.warn("Admin lookup failed", { input: accountId, evm, hedera, db: process.env.DATABASE_URL });
        return res.status(403).json({ error: "Not an admin wallet" });
    }

    const nonce = `admin:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.adminLoginNonce.create({
        data: { kind, accountId: evm ?? hedera!, nonce, expiresAt },
    });

    res.status(200).json({ nonce, expiresAt });
    return;
});


// 2) Verify signature
router.post("/auth/verify", async (req, res) => {
    const { accountId, signature, nonce } = req.body ?? {};
    if (!accountId || !signature || !nonce)
        return res.status(400).json({ error: "Missing fields" });

    const { evm, hedera, kind } = normalize(accountId);
    if (!evm && !hedera || !kind) {
        return res.status(400).json({ error: "Invalid wallet format" });
    }
    const rec = await prisma.adminLoginNonce.findFirst({
        where: { kind, accountId, nonce, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: "desc" },
    });
    if (!rec) return res.status(401).json({ error: "Invalid or expired nonce" });

    if (kind === "EVM") {
        const recovered = verifyMessage(rec.nonce, signature);
        if (getAddress(recovered) !== getAddress(accountId)) {
            return res.status(401).json({ error: "Signature mismatch" });
        }
    } else {
        // TODO: add Hedera Verification
        return res.status(400).json({ error: "Hedera admin sign-in not implemented yet" });
    }

    await prisma.adminLoginNonce.update({ where: { id: rec.id }, data: { consumedAt: new Date() } });

    const admin = await prisma.adminAccount.findFirst({
        where: {
            OR: [
                evm ? { walletEvm: { equals: evm, mode: "insensitive" } } : undefined,
                hedera ? { walletHedera: { equals: hedera, mode: "insensitive" } } : undefined,
            ].filter(Boolean) as any,
        },
        select: { id: true, walletEvm: true, walletHedera: true, role: true },
    });
    if (!admin) return res.status(403).json({ error: "Not an admin wallet" });

    const accessToken = await signSessionToken({
        isAdmin: true,
        adminId: admin.id,
        role: admin.role as any,
        subType: "admin"
    });

    res.status(200).json({ accessToken });
    return;
});

// New routes

*/

/**
 * PATCH /partners/:id
 * Admin-only: Edit a partner's details
 */

/*
router.post(
    "/partners/:id",
    requireAdminAuth,
    async (req: Request, res: Response) => {
        const { id } = req.params;
        const {
            name,
            contact,
            tier,
            requestLimitOverride,
            multiDrip,
            accounts,
        } = req.body;

        try {
            const result = await prisma.$transaction(async (tx) => {
                // 1. Update the base partner fields
                const updatedPartner = await tx.partner.update({
                    where: { id },
                    data: {
                        ...(name && { name }),
                        ...(contact !== undefined && { contact }),
                        ...(tier && { tier }),
                        ...(requestLimitOverride !== undefined && { requestLimitOverride }),
                        ...(multiDrip !== undefined && { multiDrip }),
                    },
                });

                // 2. Sync partner accounts if provided
                let updatedAccounts: PartnerAccount[] = [];

                if (Array.isArray(accounts)) {
                    // Fetch existing accounts from DB
                    const existingAccounts = await tx.partnerAccount.findMany({
                        where: { partnerId: id },
                    });

                    const existingIds = existingAccounts.map((a) => a.id);
                    const payloadIds = accounts
                        .filter((a) => a.id)
                        .map((a) => a.id as string);

                    // (A) Delete accounts in DB that aren't in payload
                    const toDeleteIds = existingIds.filter(
                        (dbId) => !payloadIds.includes(dbId)
                    );

                    if (toDeleteIds.length > 0) {
                        await tx.partnerAccount.deleteMany({
                            where: { id: { in: toDeleteIds } },
                        });
                    }

                    // (B) Create new accounts that don't exist in DB (no id in payload)
                    const newAccounts = accounts.filter((a) => !a.id);
                    if (newAccounts.length > 0) {
                        await Promise.all(
                            newAccounts.map((a: any) =>
                                tx.partnerAccount.create({
                                    data: {
                                        partnerId: id,
                                        type: a.type,
                                        accountId: a.accountId,
                                        network: a.network ?? "MAINNET",
                                        chainId: a.type === "EVM" ? a.chainId ?? 1 : null,
                                        role: a.role ?? "OWNER",
                                        isLoginIdentity: a.isLoginIdentity ?? false,
                                    },
                                })
                            )
                        );
                    }

                    // (C) Keep existing accounts untouched
                    updatedAccounts = await tx.partnerAccount.findMany({
                        where: { partnerId: id },
                    });
                }

                return { updatedPartner, updatedAccounts };
            });

            return res.status(200).json({
                message: "Partner updated successfully",
                partner: result.updatedPartner,
                accounts: result.updatedAccounts,
            });
        } catch (error) {
            console.error("Error updating partner:", error);
            return res.status(500).json({ error: "Internal Server Error" });
        }
    }
);
*/


/**
 * POST /partners/:partnerId/accounts
 * Admin-only: Add a new account for a partner
 */

/*
router.post(
    "/partners/:partnerId/accounts",
    requireAdminAuth,
    async (req: Request, res: Response) => {
        const { partnerId } = req.params;
        const { type, accountId, role } = req.body;

        if (!type || !accountId) {
            return res.status(400).json({ error: "Account type and accountId are required." });
        }

        try {
            const newAccount = await prisma.partnerAccount.create({
                data: {
                    partnerId,
                    type,
                    accountId,
                    role,
                },
            });
            return res.status(201).json({ account: newAccount });
        } catch (error) {
            console.error("Error creating partner account:", error);
            return res.status(500).json({ error: "Internal server error." });
        }
    }
);

*/
// TODO edit account (not much additional info), account perms (More info needed, keeping it basic is fine i would think)
/**
 * DELETE /partner/:id
 * Admin-only route: Delete
 */

/*
router.delete(
    "/partner/:id",
    requireAdminAuth,
    async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ error: "Missing partner id." });
        }

        try {
            const deletedPartner = await prisma.partner.delete({
                where: { id },
            });

            return res.status(200).json({
                message: `Partner '${deletedPartner.name}' deleted successfully.`,
            });
        } catch (error) {
            console.error("Error deleting partner:", error);
            return res.status(500).json({ error: "Internal server error." });
        }
    }
);
*/
/**
 * GET All partners
 * Admin-only route: fetch all partners
 */



router.get(
    "/partners",
    requireAdminAuthentication,
    async (req: Request, res: Response) => {

        try {
            const allPartners = await prisma.apiPartner.findMany();
            const partners = await Promise.all(
                allPartners.map(async (p) => {
                    const balance = await fetchPartnerBalanceFromApi(p.accountId);

                    return {
                        partner_id: p.id,
                        partner_name: p.name,
                        partner_drip_amount_in_usd: p.dripAmountInUsd,
                        partner_threshold: p.threshold,
                        partner_account_id: p.accountId,
                        partner_balance: balance,
                    };
                })
            );
            return res.status(200).json({ partners });
        } catch (error) {
            console.error("Error fetching all partner:", error);
            return res.status(500).json({ error: "Internal server error." });
        }
    }
);


export default router;

async function fetchPartnerBalanceFromApi(accountId: string) {
    const res = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
    const data = await res.json();
    return Hbar.fromTinybars(data.balance.balance).toString();
}

