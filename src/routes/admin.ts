import { Router, Request, Response } from "express";
import { PartnerUserStatus, PrismaClient } from "@prisma/client";
import { issueApiKey } from "../utils/apiKey"; // optional if you want to mint a key here
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import { getHederaClient } from "../utils/getHederaClient";
import { requireAdminAuthentication } from "../middleware/adminAuth";
import { AccountCreateTransaction, Hbar, PrivateKey } from "@hashgraph/sdk";
import { requirePartnerAuthentication } from "../middleware/partnerAuth";
import { generateVerificationToken, sendVerificationEmail } from "./partner";

const router = Router();
const prisma = new PrismaClient();
const kmsAdapter =
    process.env.KEY_ENV === "gcp"
        ? makeGcpKmsAdapter()
        : makeLocalKmsAdapter();




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

router.post('/add-new-partner', requireAdminAuthentication, async (req, res) => {
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

    if (receipt.status.toString() !== "SUCCESS") {
        return res.status(500).json({
            code: "ACCOUNT_CREATION_FAILED",
            status: receipt.status.toString(),
        });
    }

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
            await issueApiKey(prisma, kmsAdapter, {
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

