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



export async function requirePartnerAuthentication(
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

    if (payload.isAdmin || payload.adminId) {
      return res.status(403).json({ error: "Admin Token detected" });
    }

    (req as any).user = {
      userId: payload.memberId,
      partnerId: payload.partnerId,
      role: payload.role,
    };
    
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

