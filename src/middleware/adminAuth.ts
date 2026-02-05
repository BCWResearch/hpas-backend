// middleware/adminAuth.ts
import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../utils/jwt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function requireRecentAdminStepUp(minutes = 1) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ts = (req as any).admin?.stepUpAt?.getTime?.() ?? 0;
    if (!ts) return res.status(401).json({ error: "Step-up required" });
    if (Date.now() - ts >= minutes * 60 * 1000) {
      return res.status(401).json({ error: "Step-up expired" });
    }
    next();
  };
}

export async function requireAdminAuthentication(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: "Missing session" });
  }

  try {
    const payload = await verifySessionToken(token);

    const check2 = await prisma.apiAdminSession.findUnique({
      where: {
        jti: payload.jti,
      }
    });
    if (!check2 || check2.revokedAt || check2.expiresAt < new Date()) {
      res.clearCookie("session", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      });
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    if (!payload.isAdmin || !payload.adminId) {
      return res.status(403).json({ error: "Admin privileges required" });
    }
    (req as any).admin = {
      adminId: payload.adminId,
      role: payload.role,
    };
    next();
  } catch {
    res.clearCookie("session", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

