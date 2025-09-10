import { Router, Request, Response } from "express";
import { KeyEnv, PrismaClient } from "@prisma/client";
import { parsePlaintextKey } from "../utils/apiKey";
import argon2 from "argon2";
import { ROUTE_CONFIG } from "../constant/routeMap";

const router = Router();
const prisma = new PrismaClient();

const DEFAULT_WINDOW_SECONDS = 60; // throttle window
const ROUTE_SCOPE_MAP: Record<string, string> = {
  "/api/autofaucet/drip": "autofaucet:drip",
  "/api/faucet/check-EVM": "faucet:check-EVM",
  "/api/faucet/check-hedera": "faucet:check-hedera",
  "/api/faucet/faucet-claim": "faucet:drip",
  "/api/score/:accountId": "passport:score",

};
const ROUTE_COST_MAP: Record<string, number> = {
  "/api/autofaucet/drip": 1,
  "/api/score/:accountId": 1,
  "/api/faucet/check-EVM": 1,
  "/api/faucet/check-hedera": 1,
  "/api/faucet/faucet-claim": 1,
};

// Verifies Access via API Key
router.post("/verify-access", async (req: Request, res: Response) => {
  const started = Date.now();
  const h = req.header("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const originalRoute: string | undefined = req.body?.route || req.body?.originalRoute;
  const method = (req.body?.method || "POST").toUpperCase();

  if (!token) return res.status(401).json({ error: "Missing API key" });
  if (!originalRoute) return res.status(400).json({ error: "Missing route" });

  // 1) Resolve required scope
  const requiredScope = ROUTE_CONFIG[originalRoute].scope;
  if (!requiredScope) {
    return res.status(400).json({ error: `Unrecognized route '${originalRoute}'` });
  }
  const costUnits = ROUTE_CONFIG[originalRoute].cost ?? 1;

  // 2) Parse + lookup by prefix
  let parsed: { env: "LIVE" | "TEST"; type: "FAUCET" | "HASHPASS"; prefix: string };
  try {
    parsed = parsePlaintextKey(token);
  } catch {
    return res.status(401).json({ error: "Invalid API key format" });
  }
  console.log(parsed);
  const key = await prisma.apiKey.findUnique({
    where: { prefix: parsed.prefix },
    include: {
      partner: true,
      scopes: true,
    },
  });
  console.log(key?.keyHash);
  if (!key || key.revoked) return res.status(401).json({ error: "Key revoked or not found" });
  if (key.expiresAt && key.expiresAt < new Date())
    return res.status(401).json({ error: "Key expired" });

  // 3) Verify signature (argon2.verify)
  const good = await argon2.verify(key.keyHash, token);
  console.log(good);
  if (!good) return res.status(401).json({ error: "Invalid API key" });

  // 4) Scope check (either present on key or allowed by tier’s features)
  const keyHasScope = key.scopes.some((s) => s.scope === requiredScope);
  let tierAllowsScope = false;
  if (!keyHasScope) {
    const plan = await prisma.tierPlan.findUnique({ where: { name: key.partner.tier } });
    tierAllowsScope = !!plan?.features?.includes(requiredScope);
  }
  if (!keyHasScope && !tierAllowsScope) {
    return res.status(403).json({ error: "Insufficient scope" });
  }
  console.log("KS:", keyHasScope);

  // 5) Rate limit (ApiUsageWindow)
  //   Get effective limit: Partner.requestLimitOverride ?? TierPlan.requestLimit
  const tierPlan = await prisma.tierPlan.findUnique({ where: { name: key.partner.tier } });
  const effectiveLimit = key.partner.requestLimitOverride ?? tierPlan?.requestLimit ?? 0;
  if (effectiveLimit <= 0) {
    return res.status(403).json({ error: "No request allowance for this partner" });
  }
  console.log(effectiveLimit);

  // Windowing (per key + route + fixed-size window)
  const windowSeconds = DEFAULT_WINDOW_SECONDS;
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * (windowSeconds * 1000));
  const windowEnd = new Date(windowStart.getTime() + windowSeconds * 1000);

  try {
    // Atomic upsert + increment
    const usage = await prisma.apiUsageWindow.upsert({
      where: {
        apiKeyId_route_windowStart_windowEnd: {
          apiKeyId: key.id,
          route: originalRoute,
          windowStart,
          windowEnd,
        },
      },
      update: { count: { increment: costUnits } },
      create: {
        partnerId: key.partnerId,
        apiKeyId: key.id,
        route: originalRoute,
        windowStart,
        windowEnd,
        count: costUnits,
      },
    });
    console.log('6');
    if (usage.count > effectiveLimit) {
      // Optional: also write a log row for rejected attempts
      await prisma.apiRequestLog.create({
        data: {
          partnerId: key.partnerId,
          apiKeyId: key.id,
          route: originalRoute,
          statusCode: 429,
          costUnits,
          ipHash: hashIp(req.ip),
        },
      });

      console.log('7');

      return res.status(429).json({
        error: "Rate limit exceeded",
        limit: effectiveLimit,
        windowSeconds,
        route: originalRoute,
      });
    }
  } catch (e) {
    console.error("Rate-limit upsert failed", e);
    return res.status(500).json({ error: "Internal Error (rate limiting)" });
  }

  // 6) Optional: request log (non-blocking semantics if failure)
  try {
    console.log('8');
    await prisma.apiRequestLog.create({
      data: {
        partnerId: key.partnerId,
        apiKeyId: key.id,
        route: originalRoute,
        statusCode: 200,
        costUnits,
        ipHash: hashIp(req.ip),
      },
    });
    // lightweight "last used" update (don’t await)
    console.log('9');
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => { });
  } catch (e) {
    // swallow logging errors
    console.warn("request log write failed", e);
  }
  console.log('10');

  // 7) Success — return context for upstream (if you want)
  res.status(200).json({
    ok: true,
    partner: {
      id: key.partner.id,
      name: key.partner.name,
      tier: key.partner.tier,
    },
    apiKey: {
      id: key.id,
      env: key.env,
      type: key.type,
      prefix: key.prefix,
    },
    scope: requiredScope,
    route: originalRoute,
  });
  return;
});

export default router;

// --- tiny helpers ---
function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  try {
    return require("crypto").createHash("sha256").update(ip).digest("hex");
  } catch {
    return undefined;
  }
}