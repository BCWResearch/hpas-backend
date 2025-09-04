import crypto from "crypto";
import argon2 from "argon2";
import { Prisma, PrismaClient } from "@prisma/client";
import type { KeyEnv, KeyType } from "@prisma/client"; // <-- use these

/** -----------------------------
 *  Config
 *  ----------------------------*/
const KEY_BYTES = 32;           // 256-bit secret
const PREFIX_BYTES = 6;         // short human prefix core (~8-10 chars b64url)
const ARGON2_OPTS: argon2.Options & { type: number } = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16, // 64MB
  timeCost: 3,
  parallelism: 1,
};

/** KMS adapter so you can plug in AWS KMS / GCP KMS / Azure KV */
export interface KmsAdapter {
  kmsKeyId: string;                         // which master key to use
  wrap(dek: Buffer): Promise<Buffer>;       // returns wrapped DEK
  unwrap(wrappedDek: Buffer): Promise<Buffer>; // returns raw DEK
}

/** -----------------------------
 *  Helpers
 *  ----------------------------*/
const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

function randToken(bytes: number) {
  return b64url(crypto.randomBytes(bytes));
}

/** AES-256-GCM authenticated encryption with AAD */
function aeadEncrypt(plain: Buffer, dek: Buffer, aad: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, iv, tag };
}

function aeadDecrypt(ct: Buffer, iv: Buffer, tag: Buffer, dek: Buffer, aad: Buffer) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** pk_<env>_<type>_<prefix>_<secret> */
export function composePlaintextKey(params: {
  env: KeyEnv;
  type: KeyType;
  prefix: string; // short
  secret: string; // long
}) {
  const { env, type, prefix, secret } = params;
  return `pk_${env.toLowerCase()}_${type.toLowerCase()}_${prefix}_${secret}`;
}

/** Safe parser for Bearer keys */
export function parsePlaintextKey(k: string): {
  env: KeyEnv;
  type: KeyType;
  prefix: string;
  secret: string;
} {
  const parts = k.split("_");
  if (parts.length < 5 || parts[0] !== "pk") throw new Error("Invalid API key format");
  const env = parts[1].toUpperCase();
  const type = parts[2].toUpperCase();
  const prefix = parts[3];
  const secret = parts.slice(4).join("_");
  if (env !== "LIVE" && env !== "TEST") throw new Error("Invalid env in key");
  if (type !== "FAUCET" && type !== "HASHPASS") throw new Error("Invalid type in key");
  if (!prefix || !secret) throw new Error("Invalid key components");
  return { env: env as KeyEnv, type: type as KeyType, prefix, secret };
}

export async function hashKey(plaintext: string) {
  return argon2.hash(plaintext, ARGON2_OPTS);
}

export function redactKeyDisplay(plaintextOrPrefix: string) {
  if (plaintextOrPrefix.startsWith("pk_")) {
    const { env, type, prefix } = parsePlaintextKey(plaintextOrPrefix);
    return `pk_${env.toLowerCase()}_${type.toLowerCase()}_${prefix}_•••••••••••••`;
  }
  return `${plaintextOrPrefix}_•••••••••••••`;
}

/** -----------------------------
 *  Public API
 *  ----------------------------*/

export type IssueKeyInput = {
  partnerId: string;
  env: KeyEnv;
  type: KeyType;
  scopes?: string[];
  expiresAt?: Date | null;
  /** Optional human-friendly hint to group prefixes (e.g. partner slug) */
  prefixHint?: string;
};

export type IssuedKey = {
  id: string;
  prefix: string;
  env: KeyEnv;
  type: KeyType;
  scopes: string[];
  expiresAt: Date | null;
  /** Returned once on create (and on portal reveal via decrypt) */
  plaintext: string;
};

/**
 * Mint + persist a key:
 *  - generate pretty key string
 *  - hash for auth; encrypt plaintext for future portal reveals
 *  - insert scopes
 *  - return plaintext once
 */
export async function issueApiKey(
  prisma: PrismaClient | Prisma.TransactionClient,
  kms: KmsAdapter,
  input: IssueKeyInput
): Promise<IssuedKey> {
  const { partnerId, env, type } = input;

  // 1) Generate materials
  const prefixCore = input.prefixHint ? `${input.prefixHint}-${randToken(PREFIX_BYTES)}` : randToken(PREFIX_BYTES);
  const prefix = `${env.toLowerCase()}_${prefixCore}`; // e.g. "live_ab12cdEF"
  const secret = randToken(KEY_BYTES);
  const plaintext = composePlaintextKey({ env, type, prefix, secret });

  // 2) Hash for auth
  const keyHash = await hashKey(plaintext);

  // 3) Encrypt plaintext with per-record DEK, wrapped via KMS
  const dek = crypto.randomBytes(32);
  const wrappedDek = await kms.wrap(dek);
  const aad = Buffer.from(`${partnerId}|${env}|${type}|${prefix}`, "utf8");
  const { ct, iv, tag } = aeadEncrypt(Buffer.from(plaintext, "utf8"), dek, aad);

  // 4) Persist ApiKey
  const key = await prisma.apiKey.create({
    data: {
        partnerId,
        keyHash,
        prefix,
        env,
        type,
        expiresAt: input.expiresAt ?? null,
        kmsKeyId: kms.kmsKeyId,
        secretCiphertext: ct,
        secretIv: iv,
        secretTag: tag,
        wrappedDek,
    },
    select: { id: true, env: true, type: true, expiresAt: true, prefix: true },
  });

  // 5) Scopes
  const scopes = input.scopes ?? [];
  if (scopes.length) {
    await prisma.apiKeyScope.createMany({
      data: scopes.map((s) => ({ apiKeyId: key.id, scope: s })),
      skipDuplicates: true,
    });
  }

  return {
    id: key.id,
    prefix: key.prefix,
    env: key.env as KeyEnv,
    type: key.type as KeyType,
    scopes,
    plaintext,
    expiresAt: key.expiresAt ?? null,
  };
}

/**
 * Reveal plaintext for the portal (step-up/MFA gate this in your route).
 * Does NOT change the key; just decrypts and returns it.
 */
export async function revealApiKey(
  prisma: PrismaClient | Prisma.TransactionClient,
  kms: KmsAdapter,
  apiKeyId: string,
  aadContext?: { partnerId: string; env: KeyEnv; type: KeyType; prefix: string }
): Promise<string> {
  const rec = await prisma.apiKey.findUniqueOrThrow({
    where: { id: apiKeyId },
    select: {
      id: true,
      partnerId: true,
      env: true,
      type: true,
      prefix: true,
      kmsKeyId: true,
      wrappedDek: true,
      secretCiphertext: true,
      secretIv: true,
      secretTag: true,
    },
  });

  if (rec.kmsKeyId !== kms.kmsKeyId) {
    throw new Error("KMS key mismatch");
  }

  const dek = await kms.unwrap(Buffer.from(rec.wrappedDek as Buffer));
  const aad = Buffer.from(
    `${aadContext?.partnerId ?? rec.partnerId}|${aadContext?.env ?? rec.env}|${aadContext?.type ?? rec.type}|${aadContext?.prefix ?? rec.prefix}`,
    "utf8"
  );

  const pt = aeadDecrypt(
    Buffer.from(rec.secretCiphertext as Buffer),
    Buffer.from(rec.secretIv as Buffer),
    Buffer.from(rec.secretTag as Buffer),
    dek,
    aad
  ).toString("utf8");

  await prisma.apiKey.update({
    where: { id: rec.id },
    data: { lastRevealedAt: new Date(), revealedCount: { increment: 1 } },
  });

  return pt;
}

/**
 * Verify an incoming Bearer token (use in your auth middleware).
 *  - parse → get prefix
 *  - fetch by prefix
 *  - argon2.verify(storedHash, plaintext)
 */
export async function verifyBearerApiKey(
  prisma: PrismaClient,
  bearer: string
): Promise<{
  ok: true;
  apiKey: { id: string; partnerId: string; env: KeyEnv; type: KeyType };
} | { ok: false; error: string }> {
  let parsed;
  try {
    parsed = parsePlaintextKey(bearer);
  } catch {
    return { ok: false, error: "INVALID_FORMAT" };
  }

  const row = await prisma.apiKey.findUnique({
    where: { prefix: parsed.prefix },
    select: { id: true, partnerId: true, keyHash: true, env: true, type: true, revoked: true, expiresAt: true },
  });
  if (!row || row.revoked) return { ok: false, error: "REVOKED_OR_NOT_FOUND" };
  if (row.expiresAt && row.expiresAt < new Date()) return { ok: false, error: "EXPIRED" };

  const good = await argon2.verify(row.keyHash, bearer);
  if (!good) return { ok: false, error: "BAD_SIGNATURE" };

  return { ok: true, apiKey: { id: row.id, partnerId: row.partnerId, env: row.env as KeyEnv, type: row.type as KeyType } };
}
