import { Router, Request, Response } from "express";
import { PrismaClient, PartnerAccount, AccountType } from "@prisma/client";
import { issueApiKey } from "../utils/apiKey"; // optional if you want to mint a key here
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import crypto from "crypto";
import { getAddress, verifyMessage } from "ethers";
import { signSessionToken } from "../utils/jwt";
import { requireAdminAuth } from "../middleware/adminAuth";

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


/**
 * POST /add-new-partner
 * Admin-only route: creates a new Partner record.
 * (Authentication/authorization middleware should wrap this router.)
 * 
 * TODO: Add scope declarations to the FE so we can configure access to individual routes?
 * 
 */

router.post(
    "/add-new-partner",
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
    if ( !accountId || !signature || !nonce)
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

/**
 * DELETE /partner/:id
 * Admin-only route: Delete
 */

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

/**
 * GET All partners
 * Admin-only route: fetch all partners
 */

router.get(
    "/partners",
    requireAdminAuth,
    async (req: Request, res: Response) => {

        try {
            const allPartners = await prisma.partner.findMany({ include: { accounts: true, requestLogs: true } });

            return res.status(200).json({ allPartners })
        } catch (error) {
            console.error("Error fetching all partner:", error);
            return res.status(500).json({ error: "Internal server error." });
        }
    }
);


/**
 * PATCH /partners/:id
 * Admin-only: Edit a partner's details
 */
router.patch("/partners/:id", requireAdminAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, contact, tier, requestLimitOverride } = req.body;

  try {
    const updatedPartner = await prisma.partner.update({
      where: { id },
      data: { name, contact, tier, requestLimitOverride },
    });
    return res.status(200).json({ partner: updatedPartner });
  } catch (error) {

    console.error("Error updating partner:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});


/**
 * POST /partners/:partnerId/accounts
 * Admin-only: Add a new account for a partner
 */
router.post(
  "/partners/:partnerId/accounts",
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const { partnerId } = req.params;
    const { type, accountId , role } = req.body;

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


// TODO edit account (not much additional info), account perms (More info needed, keeping it basic is fine i would think)

export default router;
