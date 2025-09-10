// src/routes/partner.ts
import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient, AccountType } from "@prisma/client";
import crypto from "crypto";
import { issueApiKey, revealApiKey } from "../utils/apiKey";
import { makeLocalKmsAdapter } from "../utils/kms/local"; // swap to GCP in prod
import { getAddress, id, verifyMessage } from "ethers";
import { sha256 } from "../utils/jwt";
import { registerSecureJti, consumeSecureJti } from "../utils/secureJti";
import { signSecureToken, signSessionToken } from "../utils/jwt";
import { requireSessionAuth } from "../middleware/partnerAuth";
import { requireSecure } from "../middleware/secureGate";

const prisma = new PrismaClient();
const router = Router();
const kms = makeLocalKmsAdapter();

/** Attach req.auth from your JWT/session middleware after /auth/verify */
type AuthCtx = { partnerId: string; memberId: string; stepUpAt?: Date };
declare global {
  namespace Express {
    interface Request { auth?: AuthCtx }
  }
}

/** Require recent step-up (fresh signature) within N minutes before sensitive ops */
const requireRecentStepUp = (minutes = 5) => (req: Request, res: Response, next: NextFunction) => {
  const stepUp =
    (req as any).auth?.stepUpAt ??
    (req as any).secureClaims?.stepUpAt; // <— read from secure as fallback
  const ts = stepUp instanceof Date ? stepUp.getTime() : Number(stepUp || 0);
  if (!ts) return res.status(401).json({ error: "Step-up required" });
  if (Date.now() - ts >= minutes * 60 * 1000)
    return res.status(401).json({ error: "Step-up expired" });
  next();
};


// --- helpers (reuse if you already have them elsewhere) ---
const isEvm = (s: string) => /^0x[0-9a-fA-F]{40}$/.test((s ?? "").trim());
const isHedera = (s: string) => /^\d+\.\d+\.\d+$/.test((s ?? "").trim());
const normalizeAccountId = (raw?: string) => {
  const t = (raw ?? "").trim();
  if (isEvm(t)) return { evm: t.toLowerCase(), hedera: null as string | null, type: 'EVM' as AccountType };
  if (isHedera(t)) return { evm: null as string | null, hedera: t };
  return { evm: null as string | null, hedera: null as string | null, type: 'HEDERA' as AccountType };
};

// ==============================
// PARTNER SESSION SIGN-IN (nonce)
// ==============================

// 1) get a one-time nonce tied to wallet (+ optional network/chainId)
router.post("/auth/signin/nonce", async (req, res) => {
  const { accountId, network, chainId } = req.body ?? {};
  if (!accountId) return res.status(400).json({ error: "Missing wallet" });

  // Optional: early format guard
  const { evm, hedera, type } = normalizeAccountId(accountId);
  if (!evm && !hedera || !type) return res.status(400).json({ error: "Invalid wallet format" });

  // Only mint a nonce if this wallet is actually allowed to sign in
  const loginIdentity = await prisma.partnerAccount.findFirst({
    where: {
      type,
      accountId: { equals: accountId, mode: "insensitive" },
      network: network ?? "MAINNET",
      chainId: type === "EVM" ? (chainId ?? 1) : null,
      isLoginIdentity: true,
    },
    select: { id: true },
  });
  if (!loginIdentity) return res.status(401).json({ error: "Invalid Login Identity" });

  const nonce = `signin:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.walletLoginNonce.create({
    data: {
      type,
      accountId, // keep raw; we’ll match by nonce later
      network: network ?? "MAINNET",
      chainId: type === "EVM" ? (chainId ?? 1) : null,
      nonce,
      expiresAt,
    },
  });

  res.status(200).json({ nonce, expiresAt });
  return;
});

// 2) wallet signs the nonce → verify → issue 15m SESSION JWT
router.post("/auth/signin/verify", async (req, res) => {
  const { accountId, signature, nonce } = req.body ?? {};
  if (!accountId || !signature || !nonce)
    return res.status(400).json({ error: "Missing fields" });

  const { evm, hedera, type } = normalizeAccountId(accountId);
  if (!evm && !hedera || !type) return res.status(400).json({ error: "Invalid wallet format" });

  // Find the freshest, unconsumed nonce by nonce value (avoids case-sensitivity pitfalls)
  const rec = await prisma.walletLoginNonce.findFirst({
    where: { nonce, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "desc" },
  });
  if (!rec) return res.status(401).json({ error: "Invalid or expired nonce" });
  if (rec.type !== type) return res.status(401).json({ error: "Kind mismatch" });

  // Verify signature for EVM; TODO: add Hedera path if needed
  if (type === "EVM") {
    const recovered = verifyMessage(rec.nonce, signature);
    if (getAddress(recovered) !== getAddress(accountId)) {
      return res.status(401).json({ error: "Signature mismatch" });
    }
  } else {
    // Implement HashPack / Hedera verification when ready
    return res.status(400).json({ error: "Hedera sign-in not implemented yet" });
  }

  // Mark nonce consumed
  await prisma.walletLoginNonce.update({
    where: { id: rec.id },
    data: { consumedAt: new Date() },
  });

  // Map wallet → member (must be a login identity)
  const member = await prisma.partnerAccount.findFirst({
    where: {
      type,
      accountId: { equals: accountId, mode: "insensitive" },
      network: rec.network,
      chainId: rec.chainId ?? undefined,
      isLoginIdentity: true,
    },
    select: { id: true, partnerId: true, role: true },
  });
  if (!member) return res.status(403).json({ error: "Wallet not authorized for this partner" });

  // Issue a 15-minute SESSION token (not a secure 20s token)
  const portalToken = await signSessionToken(
    {
      subType: "partner",
      isAdmin: false,
      partnerId: member.partnerId,
      memberId: member.id,
      role: member.role as any,
    },
    "15m"
  );

  // Option A: return JSON
  return res.status(200).json({
    partnerId: member.partnerId,
    memberId: member.id,
    role: member.role,
    portalToken,
    expiresIn: 15 * 60,
  });

  // Option B: set httpOnly cookie (commented)
  // res
  //   .cookie("portalSession", portalToken, {
  //     httpOnly: true,
  //     secure: true,
  //     sameSite: "strict",
  //     maxAge: 15 * 60 * 1000,
  //   })
  //   .json({ partnerId: member.partnerId, memberId: member.id, role: member.role });
});


// Partner Routes will utilize a 1 min JWT for revealing keys + regeneration. We use sign in above to sign a partner into the app, and use JWTs only to protect powerful routes.
router.post("/auth/nonce", async (req, res) => {
  const { accountId, network, chainId } = req.body ?? {};
  if (!accountId) return res.status(400).json({ error: "Missing wallet" });

  const { evm, hedera, type } = normalizeAccountId(accountId);
  if (!evm && !hedera || !type) return res.status(400).json({ error: "Invalid wallet format" });

  const nonce = `stepup:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await prisma.walletLoginNonce.create({
    data: {
      type,
      accountId,
      network: network ?? "MAINNET",
      chainId: type === "EVM" ? chainId ?? 1 : null,
      nonce,
      expiresAt,
    },
  });
  res.status(200).json({ nonce, expiresAt });
  return;
});


// Verify signature → issue a 1 minute secure token for a specific sensitive route
router.post("/auth/verify", async (req, res) => {
  const { accountId, network, chainId, signature, nonce, action, keyId } = req.body ?? {};
  if (!accountId || !signature || !nonce || !action || !keyId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const { evm, hedera, type } = normalizeAccountId(accountId);
  if (!evm && !hedera || !type) return res.status(400).json({ error: "Invalid wallet format" });

  // 1) Find fresh nonce
  const rec = await prisma.walletLoginNonce.findFirst({
    where: {
      type,
      accountId,
      network: network ?? "MAINNET",
      chainId: type === "EVM" ? chainId ?? 1 : null,
      nonce,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: "desc" },
  });
  if (!rec) return res.status(401).json({ error: "Invalid or expired nonce" });

  // 2) Verify signature (EVM shown; add Hedera path if needed)
  if (type === "EVM") {
    const recovered = verifyMessage(rec.nonce, signature);
    if (getAddress(recovered) !== getAddress(accountId)) {
      return res.status(401).json({ error: "Signature mismatch" });
    }
  }
  await prisma.walletLoginNonce.update({ where: { id: rec.id }, data: { consumedAt: new Date() } });

  // 3) Map wallet → partner (must be a valid login identity)
  const member = await prisma.partnerAccount.findFirst({
    where: {
      type,
      accountId: { equals: accountId, mode: "insensitive" },
      network: rec.network,
      chainId: rec.chainId ?? undefined,
      isLoginIdentity: true,
    },
    select: { id: true, partnerId: true, role: true },
  });
  if (!member) return res.status(403).json({ error: "Wallet not authorized for this partner" });

  // 4) Validate the requested resource belongs to the partner
  const keyRow = await prisma.apiKey.findFirst({
    where: { id: keyId, partnerId: member.partnerId },
    select: { id: true, revoked: true },
  });
  if (!keyRow) return res.status(404).json({ error: "Key not found" });
  if (keyRow.revoked) return res.status(400).json({ error: "Key revoked" });

  // 5) Derive binding for method/path/resourceId from action
  //    These MUST match your gated route definitions exactly.
  let method: "GET" | "POST";
  let path: string;
  if (action === "reveal") {
    method = "GET";
    path = "/api/partner/keys/:id/reveal";
  } else if (action === "regenerate") {
    method = "POST";
    path = "/api/partner/keys/:id/regenerate";
  } else {
    return res.status(400).json({ error: "Invalid action" });
  }

  // 6) Single-use JTI and optional IP/UA binding
  const jti = crypto.randomBytes(16).toString("hex");
  const ipHash = undefined;
  const uaHash = undefined;

  // 7) Mint 20s secure token (no scopes)
  const stepUpAt = Date.now();
  const accessToken = await signSecureToken(
    {
      subType: "partner",
      partnerId: member.partnerId,
      memberId: member.id,
      role: member.role as any,
      stepUpAt,
      resourceId: keyId,
      method,
      path,
      ipHash,
      uaHash,
      jti,
      isAdmin: false,
      scope: action
    },
    60 // seconds
  );

  // 8) Register JTI as single-use with tiny TTL buffer
  await registerSecureJti(jti, { ttlMs: 25_000, partnerId: member.partnerId, memberId: member.id });

  return res.status(200).json({ accessToken, partnerId: member.partnerId, expiresIn: 60, action, keyId });
});


// GET API Key (Must pass partnerAuth middleware):

// List keys (no plaintext). You can require auth here (recommended).
router.get("/keys", requireSessionAuth, async (req, res) => {
  const { partnerId } = (req as any).auth;
  const keys = await prisma.apiKey.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" },
    include: { scopes: true },
  });
  res.json({
    keys: keys.map(k => ({
      id: k.id,
      prefix: k.prefix,
      env: k.env,
      type: k.type,
      scopes: k.scopes.map(s => s.scope),
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      redacted: `pk_${k.env.toLowerCase()}_${k.type.toLowerCase()}_${k.prefix}_•••••••••`,
    })),
  });
});

router.get("/info", requireSessionAuth, async (req, res) => {
  const { partnerId } = (req as any).auth;
  const keys = await prisma.apiKey.findMany({
    where: {
      partnerId,
      revoked: false
    },
    orderBy: { createdAt: "desc" },
    include: { scopes: true },
  });
  const partnerInfo = await prisma.partner.findFirst({
    where: { id: partnerId }
  });
  const partnerAccounts = await prisma.partnerAccount.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" }, // optional
  });

  res.json({
    info: {
      id: partnerId,
      name: partnerInfo?.name,
      contact: partnerInfo?.contact,
      createdAt: partnerInfo?.createdAt,
      updatedAt: partnerInfo?.updatedAt,
      tier: partnerInfo?.tier,
      requestLimitOverride: partnerInfo?.requestLimitOverride,
      accounts: partnerAccounts.map(a => ({
        id: a.id,
        partnerId: a.partnerId,
        type: a.type,
        accountId: a.accountId,
        network: a.network,
        chainId: a.chainId,
        createdAt: a.createdAt,
        isLoginIdentity: a.isLoginIdentity,
        role: a.role,
      })),
      keys: keys.map(k => ({
        id: k.id,
        prefix: k.prefix,
        env: k.env,
        type: k.type,
        scopes: k.scopes.map(s => s.scope),
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        redacted: `pk_${k.env.toLowerCase()}_${k.type.toLowerCase()}_${k.prefix}_•••••••••`,
      })),
      requestLogs: []
    }
  });
});

// Secure reveal — requires fresh step-up (<= 5 min old)
router.get("/keys/:id/reveal",
  requireSecure('reveal'),
  requireRecentStepUp(5),
  async (req, res) => {
    const { partnerId } = (req as any).auth;
    const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!key || key.partnerId !== partnerId) return res.status(404).json({ error: "Not found" });
    if (key.revoked) return res.status(400).json({ error: "Key revoked" });

    const plaintext = await revealApiKey(prisma, kms, key.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ plaintext });
  }
);

// Regenerate — revoke current + mint new; requires fresh step-up
router.post("/keys/:id/regenerate",
  requireSecure('regenerate'),
  requireRecentStepUp(5),
  async (req, res) => {
    const { partnerId } = (req as any).auth;
    const cur = await prisma.apiKey.findUnique({ where: { id: req.params.id }, include: { scopes: true } });
    if (!cur || cur.partnerId !== partnerId) return res.status(404).json({ error: "Not found" });

    await prisma.apiKey.update({ where: { id: cur.id }, data: { revoked: true } });

    const newKey = await issueApiKey(prisma, kms, {
      partnerId,
      env: cur.env as any,
      type: cur.type as any,
      scopes: ["autofaucet:drip", "faucet:check-EVM", "faucet:check-hedera", "faucet:drip", "passport:score"],
      expiresAt: cur.expiresAt ?? null,
    });

    res.status(201).json({ key: newKey }); // includes plaintext once
  }
);

export default router;