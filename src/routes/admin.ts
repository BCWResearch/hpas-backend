import { Router, Request, Response } from "express";
import { PartnerUserStatus, PrismaClient } from "@prisma/client";
import { issueApiKey } from "../utils/apiKey"; // optional if you want to mint a key here
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import { getHederaClient } from "../utils/getHederaClient";
import { requireAdminAuthentication } from "../middleware/adminAuth";
import { AccountCreateTransaction, Hbar, PrivateKey } from "@hashgraph/sdk";
import { requirePartnerAuthentication } from "../middleware/partnerAuth";
import { generateVerificationToken, sendVerificationEmail } from "./partner";
import { sendEmail } from "../utils/email/email";


const router = Router();
const prisma = new PrismaClient();
const kmsAdapter =
    process.env.KEY_ENV === "gcp"
        ? makeGcpKmsAdapter()
        : makeLocalKmsAdapter();

const isHedera = (s: string) => /^\d+\.\d+\.\d+$/.test((s ?? "").trim());




// PARTNER CRUD OPS

/** C
 * POST /add-new-partner
 * Admin-only route: creates a new Partner record.
 * (Authentication/authorization middleware should wrap this router.)
 * 
 * TODO: Add scope declarations to the FE so we can configure access to individual routes?
 * 
 */

router.get('/emails/:id', requireAdminAuthentication, async (req, res) => {
    const { id: partnerId } = req.params;
    if (!partnerId) { return res.status(400).json({ code: "MISSING_PARTNER_ID" }); }

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

router.delete("/remove-email/:id", requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;
    try {

        await prisma.email.delete({
            where: { id }
        });

        return res.status(200).json({ success: true });
    } catch (e) {
        return res.status(500).json({ code: 'REMOVE_EMAIL_ERROR' });
    }
});

router.post('/add-email/:id', requireAdminAuthentication, async (req, res) => {
    const { id: partnerId } = req.params;
    if (!partnerId) { return res.status(400).json({ code: "MISSING_PARTNER_ID" }); }

    const { emails } = req.body;
    if (!emails) { return res.status(404).json({ code: 'MISSING_EMAILS' }) }
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

router.post('/pause-user', requireAdminAuthentication, async (req, res) => {
    const { userId } = req.body;

    const pause_user = await prisma.apiPartnerUser.update({
        where: { id: userId },
        data: { status: PartnerUserStatus.PAUSED }
    });
    if (!pause_user) { return res.status(401).json({ code: 'PAUSE_FAILED ' }) }

    return res.status(200).json({
        paused: true,
    });
});

router.post('/resume-user', requireAdminAuthentication, async (req, res) => {
    const { userId } = req.body;
    const resume_user = await prisma.apiPartnerUser.update({
        where: { id: userId },
        data: { status: PartnerUserStatus.ACTIVE }
    });
    if (!resume_user) { return res.status(401).json({ code: 'RESUME_FAILED ' }) }

    return res.status(200).json({
        resume: true,
    });
});

router.get('/users/:id', requireAdminAuthentication, async (req, res) => {
    const { id: partnerId } = req.params;
    if (!partnerId) { return res.status(400).json({ code: "MISSING_PARTNER_ID" }); }
    const partner = await prisma.apiPartner.findUnique({
        where: { id: partnerId },
        select: { users: true },
    });

    return res.status(200).json({
        users: partner?.users ?? [],
    });
});
router.get('/request-logs/:id', requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;
    if (!id) { return res.status(400).json({ code: "MISSING_PARTNER_ID" }); }
    try {
        const logs = await prisma.apiRequestLog.findMany({
            where: {
                apiPartnerId: id,
            },
            select: {
                timestamp: true,
                route: true,
                statusCode: true,
                response: true,
                success: true,
            },
            orderBy: {
                timestamp: "desc",
            },
        });

        return res.status(200).json({ logs });
    } catch (e) {
        return res.status(500).json({ code: 'INTERNAL_ERROR' });
    }
});

router.delete("/remove-user/:id", requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;
    const removeUser = await prisma.apiPartnerUser.delete({
        where: { id }
    });
    if (!removeUser) return res.status(500).json({ code: 'REMOVE_USER_FAILED' });
    return res.status(200).json({ success: true });
});

router.post("/add-new-partner", requireAdminAuthentication, async (req, res) => {
    try {
        const { name, initialUserId, point_of_contact_email } = req.body;

        if (!name || !initialUserId || !point_of_contact_email) {
            return res.status(400).json({ code: "MISSING_FIELDS" });
        }

        if (!isHedera(initialUserId)) {
            return res.status(400).json({ code: "INVALID_ACCOUNT_ID" });
        }

        const existingPartner = await prisma.apiPartner.findUnique({ where: { name } });
        if (existingPartner) {
            return res.status(409).json({ code: "PARTNER_EXISTS" });
        }

        const existingUser = await prisma.apiPartnerUser.findFirst({
            where: { accountId: initialUserId },
        });
        if (existingUser) {
            return res.status(409).json({ code: "USER_ALREADY_EXISTS" });
        }

        // create treasury
        const client = getHederaClient("mainnet");
        const newPrivateKey = PrivateKey.generateECDSA();
        const newPublicKey = newPrivateKey.publicKey;

        const txResponse = await new AccountCreateTransaction()
            .setECDSAKeyWithAlias(newPublicKey)
            .setInitialBalance(new Hbar(0.25))
            .execute(client);

        const receipt = await txResponse.getReceipt(client);

        if (receipt.status.toString() !== "SUCCESS") {
            return res.status(500).json({ code: "ACCOUNT_CREATION_FAILED" });
        }

        const encryptedPrivateKey = await kmsAdapter.wrap(
            Buffer.from(newPrivateKey.toBytes())
        );

        const partner = await prisma.apiPartner.create({
            data: {
                name,
                threshold: 0,
                dripAmountInUsd: 0,
                thresholdTriggered: false,
                encryptedPrivateKey,
                publicKey: newPublicKey.toStringDer(),
                accountId: receipt.accountId!.toString(),
            },
        });

        try {
            await prisma.apiPartnerUser.create({
                data: {
                    partnerId: partner.id,
                    accountId: initialUserId,
                    role: "OWNER",
                    status: "INVITED",
                },
            });

            await prisma.email.create({
                data: {
                    email: point_of_contact_email,
                    partnerId: partner.id,
                    verified: false,
                },
            });

            await issueApiKey(prisma, kmsAdapter, {
                apiPartnerId: partner.id,
                env: "LIVE",
                type: "FAUCET",
                scopes: ["faucet:drip", "passport:score", "faucet:transactions"],
            });

            const subject = "Welcome to HDrip — Your Organization Has Been Activated";

            const html = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
            <h2 style="margin-bottom: 8px;">Welcome to HDrip</h2>

            <p>
                Your organization has been successfully onboarded to the <strong>HDrip API</strong>.
                You now have access to your organization’s Partner Portal where you can configure
                your faucet settings and manage access.
            </p>

            <hr style="margin: 24px 0;" />

            <h3 style="margin-bottom: 8px;">Sign in to your Partner Portal</h3>

            <p>
                Please sign in using the Hedera account provided during onboarding.
            </p>

            <p style="margin: 12px 0;">
                <strong>Sign-in link:</strong><br/>
                <a href="http://localhost:5174/login" style="color:#6b5cff;">
                http://localhost:5174/login
                </a>
            </p>

            <p>
                <strong>Your sign-in Hedera Account ID:</strong><br/>
                <code style="background:#f4f4f4; padding:6px 8px; border-radius:6px;">
                ${initialUserId}
                </code>
            </p>

            <p>
                Use this account with HashPack to authenticate.
            </p>

            <hr style="margin: 24px 0;" />

            <h3 style="margin-bottom: 8px;">Getting Started</h3>

            <p>After signing in, please complete the following setup steps:</p>

            <ol>
                <li>
                <strong>Fund your faucet treasury wallet</strong><br/>
                Your organization wallet must be funded before drips can occur.
                </li>
                <li>
                <strong>Configure your drip amount</strong><br/>
                Set how much HBAR is distributed per request.
                </li>
                <li>
                <strong>Set your refill threshold</strong><br/>
                This determines when your team receives low-balance notifications.
                </li>
                <li>
                <strong>Add additional organization members</strong><br/>
                You can invite teammates and assign roles directly from the portal.
                </li>
            </ol>

            <hr style="margin: 24px 0;" />

            <h3 style="margin-bottom: 8px;">Need help?</h3>

            <p>
                If you have any questions or need assistance with setup,
                feel free to reply directly to this email or reach out to our team.
            </p>

            <p style="margin-top: 32px;">
                — Hashport Team<br/>
                <span style="color:#666;">HDrip API</span>
            </p>
            </div>
            `;
            await sendEmail(point_of_contact_email, subject, html);

        } catch (err) {
            console.error("Onboarding failed, cleaning up partner", err);

            await prisma.apiPartner.delete({
                where: { id: partner.id },
            });

            return res.status(500).json({ code: "PARTNER_SETUP_FAILED" });
        }

        return res.status(200).json({ ok: true });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ code: "INTERNAL_ERROR" });
    }
});


// R

// U
router.post("/partners/:id", requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;
    const { name, threshold, dripAmountInUsd, active } = req.body;

    const updated_partner = await prisma.apiPartner.update({
        where: { id },
        data: {
            name,
            threshold,
            dripAmountInUsd,
            active,
        },
    });


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
        select: { isPausedByAdmin: true }
    });

    if (!partner) { return res.status(404).json({ code: 'PARTNER_NOT_FOUND' }) }

    const changed_partner = await prisma.apiPartner.update({
        where: { id },
        data: { isPausedByAdmin: !partner.isPausedByAdmin }
    });

    return res.status(200).json({ success: true });
});

router.delete('/partner/:id', requireAdminAuthentication, async (req, res) => {
    const { id } = req.params;

    const partner = await prisma.apiPartner.delete({
        where: { id },
    });
    if (!partner) { return res.status(403).json({ code: 'DELETE_FAILED' }) }
    return res.status(200).json({ partner });

});


// USER CRUD OPS
router.post('/add-user-to-partner', requireAdminAuthentication, async (req, res) => {
    const { partnerId, accountId, role } = req.body;

    // Check if partner belongs to org already:
    await prisma.apiPartner.findUnique({ where: { id: partnerId } });
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
                partnerId,
                accountId,
                role,
                status: 'INVITED'
            }
        });
        if (!user) {
            return res.status(500).json({ code: 'Error adding user to org' });
        }
        return res.status(200).json({ ok: true });
    }
}
);

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
                        partner_paused: p.isPausedByAdmin
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

