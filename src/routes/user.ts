import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient, AccountType } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

router.post("/isPartner", async (req, res) => {
    const { accountId } = req.body;
    const loginIdentity = await prisma.partnerAccount.findFirst({
        where: {
            accountId: { equals: accountId, mode: "insensitive" },
            isLoginIdentity: true,
        },
        select: { id: true },
    });
    if (!loginIdentity) {
        res.status(401).json({ isPartner: false, error: 'Unauthorized' });
        return;
    }
    res.status(200).json({isPartner: true});
    return;
});

export default router;