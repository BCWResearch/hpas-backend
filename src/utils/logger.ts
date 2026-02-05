import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashIp(ip: string | undefined): string | undefined {
    if (!ip) return undefined;
    try {
        return require("crypto").createHash("sha256").update(ip).digest("hex");
    } catch {
        return undefined;
    }
}

export async function logApiRequest(partner_id: string, key_id: string, route: string, statusCode: number, response: string, costUnits: number, ip: string, success: boolean) {
    try {
        await prisma.apiRequestLog.create({
            data: {
                apiPartnerId: partner_id,
                apiKeyId: key_id,
                route,
                statusCode,
                costUnits,
                ipHash: hashIp(ip),
                success,
            },
        });
        // lightweight "last used" update (don’t await)
        prisma.apiKey.update({ where: { id: key_id }, data: { lastUsedAt: new Date() } }).catch(() => { });
    } catch (e) {
        // swallow logging errors
        console.warn("request log write failed", e);
    }
}