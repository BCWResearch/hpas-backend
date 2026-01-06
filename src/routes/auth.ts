import { Router } from "express";
import { googleClient } from "../utils/google";
import { signSessionToken } from "../utils/jwt";
import { PrismaClient } from "@prisma/client";
import { requireAdminAuthentication } from "../middleware/adminAuth";
import { requirePartnerAuthentication } from "../middleware/partnerAuth";

const prisma = new PrismaClient();

const router = Router();


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
    console.log(payload);
    // Lookup user
    const user = await prisma.apiPartnerUser.findFirst({
        where: { email },
        include: { partner: true },
    });

    if (user && user?.status === 'INVITED') {
        const add_name = await prisma.apiPartnerUser.update({
            where: { id: user.id },
            data: {
                firstName: payload.given_name ?? '',
                lastName: payload.family_name ?? '',
                status: 'ACTIVE',
            }
        });
        if (!add_name) { return res.status(403).json({ code: 'FAILED_TO_ACTIVATE_USER' }) };

    }


    // TODO: Might want to use 2FA here
    const admin = await prisma.apiPartnerAdmin.findFirst({
        where: { email },
    });


    if (!user && !admin) {
        return res.status(403).json({
            error: "You are not authorized for any partner",
        });
    }
    let session: string;

    if (admin) {
        session = await signSessionToken({
            subType: "admin",
            email: email,
            adminId: admin.id,
            role: 'ADMIN',
            isAdmin: true,
        }, "15m");
    } else if (user) {
        // Issue session
        session = await signSessionToken({
            subType: "partner",
            memberId: user.id,
            partnerId: user.partnerId,
            role: user.role,
            email: user.email,
            isAdmin: false,
        }, "15m");
    } else {
        return res.status(401).json({ code: 'USER_NOT_FOUND' });
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
    return res.status(200).json({
        user: {
            first_name: user.firstName,
            last_name: user.lastName,
            email: user.email,
            role: user.role,
        }
    });
});

router.get("/admin", requireAdminAuthentication, async (req, res) => {
    const { adminId } = (req as any).admin.adminId;
    console.log(req.body);

    const admin = await prisma.apiPartnerAdmin.findFirst({
        where: {
            id: adminId
        }
    });
    if (!admin) { return res.status(404).json({ code: 'ADMIN_NOT_FOUND' }) }
    return res.status(200).json({ user: admin });
})
export default router;
