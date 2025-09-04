// utils/secureJti.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function registerSecureJti(jti: string, ctx: { ttlMs: number; partnerId?: string; memberId?: string; adminId?: string; }) {
  const expiresAt = new Date(Date.now() + ctx.ttlMs);
  await prisma.secureTokenJti.create({
    data: { jti, purpose: "secure", expiresAt, partnerId: ctx.partnerId, memberId: ctx.memberId, adminId: ctx.adminId },
  });
}

export async function consumeSecureJti(jti: string) {
  const row = await prisma.secureTokenJti.findUnique({ where: { jti } });
  if (!row) throw new Error("unknown-jti");
  if (row.usedAt) throw new Error("used-jti");
  if (row.expiresAt.getTime() < Date.now()) throw new Error("expired-jti");
  await prisma.secureTokenJti.update({ where: { jti }, data: { usedAt: new Date() } });
}
