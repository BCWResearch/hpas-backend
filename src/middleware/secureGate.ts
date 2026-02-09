// src/middleware/secureGate.ts
import type { Request, Response, NextFunction } from "express";
import { verifySecureToken, sha256 } from "../utils/jwt";
import { assertSecureJtiValid } from "../utils/secureJti";

export function requireSecure() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.secureAccess;
      if (!token) return res.status(401).json({ error: "missing_secure_token" });

      const claims = await verifySecureToken(token);

      if (claims.resourceId !== req.params.id)
        return res.status(400).json({ error: "resource_mismatch", expected: claims.resourceId, got: req.params.id });

      if (claims.ipHash) {
        const ipH = sha256(req.ip || "");
        if (ipH !== claims.ipHash) return res.status(401).json({ error: "ip_mismatch", reqIp: req.ip });
      }
      if (claims.uaHash) {
        const uaH = sha256((req.headers["user-agent"] as string) || "");
        if (uaH !== claims.uaHash) return res.status(401).json({ error: "ua_mismatch" });
      }

      try {
        await assertSecureJtiValid(claims.jti);
      } catch (e: any) {
        // surface the precise single-use failure reason
        return res.status(401).json({ error: e?.message || "secure_jti_failed" });
      }

      (req as any).secureClaims = claims;
      (req as any).auth = {
        subType: claims.subType,
        partnerId: claims.partnerId,
        memberId: claims.memberId,
        adminId: claims.adminId,
        role: claims.role,
        stepUpAt: new Date(claims.stepUpAt ?? Date.now()),
      };
      return next();
    } catch (e: any) {
      console.error("requireSecure error", {
        msg: e?.message, url: req.originalUrl, method: req.method,
      });
      return res.status(401).json({ error: e?.message || "invalid_or_expired_secure_token" });
    }
  };
}
