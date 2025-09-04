// middleware/adminAuth.ts
import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../utils/jwt";

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.header("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = await verifySessionToken(token);
    if (!payload.isAdmin || !payload.adminId) {
      return res.status(403).json({ error: "Admin privileges required" });
    }
    (req as any).admin = {
      adminId: payload.adminId,
      role: payload.role,
      stepUpAt: payload.stepUpAt ? new Date(payload.stepUpAt) : undefined,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRecentAdminStepUp(minutes = 5) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ts = (req as any).admin?.stepUpAt?.getTime?.() ?? 0;
    if (!ts) return res.status(401).json({ error: "Step-up required" });
    if (Date.now() - ts >= minutes * 60 * 1000) {
      return res.status(401).json({ error: "Step-up expired" });
    }
    next();
  };
}
