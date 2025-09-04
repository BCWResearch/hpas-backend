// middleware/partnerAuth.ts (session)
import type { Request, Response, NextFunction } from "express";
import { getBearer, verifySessionToken } from "../utils/jwt";

export async function requireSessionAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: "Missing session token" });
    const claims = await verifySessionToken(token);
    (req as any).auth = {
      subType: claims.subType,
      partnerId: claims.partnerId,
      memberId: claims.memberId,
      adminId: claims.adminId,
      role: claims.role,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session token" });
  }
}
