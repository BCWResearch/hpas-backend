import type { Request, Response, NextFunction } from "express";
import { parsePlaintextKey } from "../utils/apiKey";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { logApiRequest } from "../utils/logger";

const prisma = new PrismaClient();

export async function requireApiKeyAuthentication(
    req: Request,
    res: Response,
    next: NextFunction
) {
    console.log("CALLED");
    const apiKey = req.get("X-API-KEY");

    if (!apiKey) return res.status(404).json({ code: "API_KEY_NOT_FOUND" });

    // 1) Resolve required scope
    // 2) Parse + lookup by prefix

    let parsed: { env: "LIVE" | "TEST"; type: "FAUCET" | "HASHPASS"; prefix: string };
    try {
        parsed = parsePlaintextKey(apiKey);
    } catch {
        return res.status(401).json({ code: "INVALID_API_KEY" });
    }
    //console.log(parsed);
    const key = await prisma.apiKey.findUnique({
        where: { prefix: parsed.prefix },
        include: {
            apiPartner: true,
            scopes: true,
        },
    });
    //console.log("HI:", key?.keyHash);
    if (!key || key.revoked) return res.status(401).json({ code: "KEY_REVOKED" });
    if (key.expiresAt && key.expiresAt < new Date())
        return res.status(401).json({ code: "KEY_EXPIRED" });

    if (!key.apiPartner.active || key.apiPartner.isPausedByAdmin) {
        await logApiRequest(key.apiPartner.id, key.id, 'drip', 403, 'SERVICE_PAUSED', 0, req.ip!, false);
        return res.status(403).json({ code: 'SERVICE_PAUSED' });
    }
    // 3) Verify signature (argon2.verify)
    const good = await argon2.verify(key.keyHash, apiKey);
    //console.log("GOOD", good);
    if (!good) return res.status(401).json({ error: "INVALID_API_KEY" });
    (req as any).partner = {
        sender_account_id: key.apiPartner.accountId,
        partner_id: key.apiPartner.id,
        drip_amount_in_usd: key.apiPartner.dripAmountInUsd,
        key_id: key.id,
    };
    next();
}
