import { Router } from "express";
import { googleClient } from "../utils/google";
import { signSecureToken, signSessionToken, verifySessionToken } from "../utils/jwt";
import { PartnerUserStatus, PrismaClient } from "@prisma/client";
import { requireAdminAuthentication } from "../middleware/adminAuth";
import { requirePartnerAuthentication } from "../middleware/partnerAuth";
import crypto from "crypto";
import { verifyHederaSignature } from "../utils/verifyHederaSignature";
import { registerSecureJti } from "../utils/secureJti";

const prisma = new PrismaClient();

const router = Router();

const isHedera = (s: string) => /^\d+\.\d+\.\d+$/.test((s ?? "").trim());

function genNonce(len = 32) {
    return crypto.randomBytes(len).toString("base64url");
}
router.get("/admin/logout", requireAdminAuthentication, async (req, res) => {
    const token = req.cookies?.session;
    if (!token) {
        return res.status(401).json({ error: "Missing session" });
    }

    const payload = await verifySessionToken(token);
    await prisma.apiAdminSession.update({
        where: { jti: payload.jti },
        data: { revokedAt: new Date() },
    });
    res.clearCookie("session", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
    });
    return res.status(200).json({ ok: true });
})
router.get("/logout", requirePartnerAuthentication, async (req, res) => {
    const { userId, partnerId } = (req as any).user;

    const user = await prisma.apiPartnerUser.findFirst({
        where: {
            id: userId,
            partnerId,
        }
    });
    if (!user) { return res.status(404).json({ code: 'USER_NOT_FOUND' }) }
    await prisma.apiPartner.findFirst({
        where: {
            id: partnerId
        },
    });
    const token = req.cookies?.session;
    if (!token) {
        return res.status(401).json({ error: "Missing session" });
    }

    const payload = await verifySessionToken(token);

    await prisma.apiSession.update({
        where: { jti: payload.jti },
        data: { revokedAt: new Date() },
    });
    res.clearCookie("session", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
    });

    return res.json({ ok: true })
})

router.post("/signin/nonce", async (req, res) => {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: "Missing wallet" });

    // Optional: early format guard
    if (!isHedera(accountId)) {
        return res.status(401).json({ code: "Invalid wallet format" });
    }

    // Only mint a nonce if this wallet is actually allowed to sign in
    const loginIdentity = await prisma.apiPartnerUser.findFirst({
        where: {
            accountId,
            OR: [
                { status: PartnerUserStatus.INVITED },
                { status: PartnerUserStatus.ACTIVE }
            ]
        },
        select: { id: true, partnerId: true },
    });
    if (!loginIdentity) return res.status(401).json({ error: "Invalid Login Identity" });
    const nonce = `signin:${Date.now()}:${genNonce(32)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.apiUserLoginNonce.create({
        data: {
            accountId, // keep raw; we’ll match by nonce later
            nonce,
            expiresAt,
        },
    });
    res.status(200).json({ nonce, expiresAt });
    return;
});

router.post("/signin/verify", async (req, res) => {
    const { accountId, signature, nonce } = req.body ?? {};
    let isFirstLogin = false;
    let showGetStartedModal = false;
    if (!accountId || !signature || !nonce) {
        return res.status(400).json({ error: "Missing fields" });
    }
    if (!isHedera(accountId)) return res.status(400).json({ error: "Invalid wallet format" });

    const verified = await verifyHederaSignature({ accountId, nonce, sigMapB64: signature });
    //console.log(verified);
    if (verified) {
        //console.log("c1");
        const compAccountId = await prisma.apiUserLoginNonce.findUnique({
            where: {
                nonce,
            }
        });
        if (!compAccountId || compAccountId.expiresAt < new Date()) {
            res.status(400).json({ code: "NONCE_USED_OR_MISSING" });
            return;
        }
        if (compAccountId.accountId != accountId) {
            res.status(403).json({ code: "ACCOUNT_MISMATCH", message: "Account does not match nonce" });
            return;
        }
        // Delete Nonce
        await prisma.apiUserLoginNonce.delete({ where: { nonce } });
        const user = await prisma.apiPartnerUser.findFirst({
            where: {
                accountId
            }
        });
        if (!user) { return res.status(404).json({ code: 'USER_NOT_FOUND' }) }
        if (user.status === PartnerUserStatus.INVITED) {
            isFirstLogin = true;
            const users = await prisma.apiPartnerUser.findMany({
                where: {
                    id: user.partnerId,
                }
            });
            if (users.length === 1) { showGetStartedModal = true; }
            await prisma.apiPartnerUser.update({ where: { id: user.id }, data: { status: PartnerUserStatus.ACTIVE } });
        }
        const jti = crypto.randomUUID();
        const session = await signSessionToken({
            jti,
            subType: "partner",
            memberId: user.id,
            partnerId: user.partnerId,
            role: user.role,
            isAdmin: false,
        }, "15m");

        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const session_store = await prisma.apiSession.create({
            data: {
                jti,
                userId: user.id,
                partnerId: user.partnerId,
                expiresAt
            }
        });
        if (!session_store) { return res.status(400).json({ code: 'SESSION_FAILED' }) }
        res.cookie("session", session, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
        });

        return res.status(200).json({ ok: true, showGetStartedModal, })
    }
});

router.post("/action/nonce", async (req, res) => {
    const { accountId, keyId, apiPartnerId } = req.body;
    if (!accountId) return res.status(400).json({ error: "Missing wallet" });

    // Optional: early format guard
    if (!isHedera(accountId)) {
        return res.status(401).json({ code: "Invalid wallet format" });
    }

    // Only mint a nonce if this wallet is actually allowed to sign in
    const loginIdentity = await prisma.apiPartnerUser.findFirst({
        where: {
            accountId,
            OR: [
                { status: PartnerUserStatus.INVITED },
                { status: PartnerUserStatus.ACTIVE }
            ]
        },
        select: { id: true, partnerId: true },
    });
    const keyPartnerCheck = await prisma.apiKey.findFirst({
        where: {
            apiPartnerId, revoked: false,
        },
    });
    if (!loginIdentity || loginIdentity.partnerId != apiPartnerId) return res.status(401).json({ error: "Invalid Login Identity" });
    if (!keyPartnerCheck || keyPartnerCheck.id != keyId) return res.status(401).json({ error: 'KEY_UNAUTHORIZED' });

    const nonce = `action:${apiPartnerId}:${keyId}:${Date.now()}:${genNonce(32)}`;
    const expiresAt = new Date(Date.now() + 1 * 60 * 1000);

    await prisma.apiUserActionNonce.create({
        data: {
            accountId, // keep raw; we’ll match by nonce later
            nonce,
            expiresAt,
        },
    });
    res.status(200).json({ nonce, expiresAt });
    return;
});

router.post("/action/verify", async (req, res) => {
    const { accountId, signature, nonce, keyId } = req.body ?? {};
    if (!accountId || !signature || !nonce) {
        return res.status(400).json({ error: "Missing fields" });
    }
    if (!isHedera(accountId)) return res.status(400).json({ error: "Invalid wallet format" });

    const verified = await verifyHederaSignature({ accountId, nonce, sigMapB64: signature });
    //console.log(verified);
    if (verified) {
        //console.log("c1");
        const compAccountId = await prisma.apiUserActionNonce.findUnique({
            where: {
                nonce,
            }
        });
        if (!compAccountId || compAccountId.expiresAt < new Date()) {
            res.status(400).json({ code: "NONCE_USED_OR_MISSING" });
            return;
        }
        if (compAccountId.accountId != accountId) {
            res.status(403).json({ code: "ACCOUNT_MISMATCH", message: "Account does not match nonce" });
            return;
        }
        // Delete Nonce

        await prisma.apiUserActionNonce.delete({ where: { nonce } });
        const user = await prisma.apiPartnerUser.findFirst({
            where: {
                accountId
            }
        });
        if (!user) { return res.status(404).json({ code: 'USER_NOT_FOUND' }) }
        const key = await prisma.apiKey.findFirst({
            where: {
                id: keyId,
                apiPartnerId: user.partnerId,
                revoked: false,
            },
        });

        if (!key) {
            return res.status(403).json({ error: "KEY_UNAUTHORIZED" });
        }
        // 6) Single-use JTI and optional IP/UA binding
        const jti = crypto.randomBytes(16).toString("hex");

        // 7) Mint 20s secure token (no scopes)
        const stepUpAt = Date.now();
        const accessToken = await signSecureToken(
            {
                subType: "partner",
                partnerId: user.partnerId,
                memberId: user.id,
                role: user.role as any,
                stepUpAt,
                resourceId: keyId,
                jti,
                isAdmin: false,
            },
            60 // seconds
        );

        // 8) Register JTI as single-use with tiny TTL buffer
        await registerSecureJti(jti, { ttlMs: 25_000, partnerId: user.partnerId, memberId: user.id });


        res.cookie("secureAccess", accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
        });

        return res.json({ ok: true })
    }
});
router.post("/google", async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ error: "Missing ID token" });
    }

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        payload = ticket.getPayload();
    } catch {
        return res.status(401).json({ error: "Invalid Google token" });
    }

    if (!payload?.email || !payload.email_verified) {
        return res.status(401).json({ error: "Unverified Google account" });
    }

    const email = payload.email.toLowerCase();
    // console.log(payload);
    // Lookup user


    // TODO: Might want to use 2FA here
    const admin = await prisma.apiPartnerAdmin.findFirst({
        where: { email },
    });


    if (!admin) {
        return res.status(403).json({
            error: "You are not authorized for admin access",
        });
    }
    let session: string;

    if (admin) {
        const jti = crypto.randomUUID();
        session = await signSessionToken({
            jti,
            subType: "admin",
            email: email,
            adminId: admin.id,
            role: 'ADMIN',
            isAdmin: true,
        }, "15m");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const session_store = await prisma.apiAdminSession.create({
            data: {
                jti,
                adminId: admin.id,
                expiresAt,
            }
        });
        if (!session_store) { return res.status(401).json({ code: 'SESSION_FAILED' }) }
    } else {
        return res.status(401).json({ code: 'ADMIN_NOT_FOUND' });
    }

    res.cookie("session", session, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
    });

    return res.json({ ok: true });
});

router.get("/partner", requirePartnerAuthentication, async (req, res) => {
    const { userId, partnerId } = (req as any).user;

    const user = await prisma.apiPartnerUser.findFirst({
        where: {
            id: userId,
            partnerId,
        }
    });
    if (!user) { return res.status(404).json({ code: 'USER_NOT_FOUND' }) }
    const partner = await prisma.apiPartner.findFirst({
        where: {
            id: partnerId
        },
        select: { name: true, dripAmountInUsd: true, threshold: true, accountId: true, active: true }
    });
    return res.status(200).json({
        user: {
            accountId: user.accountId,
            role: user.role,
        },
        partner: {
            partner_id: partnerId,
            partner_name: partner?.name,
            partner_drip_amount_in_usd: partner?.dripAmountInUsd,
            partner_threshold: partner?.threshold,
            partner_account_id: partner?.accountId,
            active: partner?.active
        },
    });
});

router.get("/admin", requireAdminAuthentication, async (req, res) => {
    const { adminId } = (req as any).admin;
    //console.log(req.body);

    const admin = await prisma.apiPartnerAdmin.findFirst({
        where: {
            id: adminId
        }
    });
    if (!admin) { return res.status(404).json({ code: 'ADMIN_NOT_FOUND' }) }
    return res.status(200).json({ user: admin });
})
export default router;
