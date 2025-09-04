// utils/jwt.ts
import { SignJWT, jwtVerify } from "jose";
import crypto from "crypto";

const ISSUER = "your-app";
const AUDIENCE = "partner-portal";
const HS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-only-secret");

// token types
type TokenType = "session" | "secure";

// shared base claims
type BaseClaims = {
    tokenType: TokenType;
    subType: "partner" | "admin";
    partnerId?: string;
    memberId?: string;
    adminId?: string;
    isAdmin: boolean;
    role?: "OWNER" | "ADMIN" | "VIEWER";
};

// long-lived (15m) session token for admins/partners
export type SessionClaims = BaseClaims & {
    tokenType: "session";
};

// very short (20s) secure token for reveal/regenerate
export type SecureClaims = BaseClaims & {
    tokenType: "secure";
    // security bindings
    stepUpAt: number;         // ms since epoch when wallet proof was verified
    scope: "reveal" | "regenerate";
    resourceId: string;       // the keyId being operated on
    method: "POST" | "GET";   // match actual route verb
    path: string;             // exact route path, e.g. `/api/partner/keys/:id/reveal`
    ipHash?: string;          // optional bind to client IP hash
    uaHash?: string;          // optional bind to UA hash
    jti: string;              // single-use id
};

export async function signSessionToken(claims: Omit<SessionClaims, "tokenType">, ttl = "15m") {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ ...claims, tokenType: "session" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(ttl)
        .sign(HS_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
    const { payload } = await jwtVerify(token, HS_SECRET, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.tokenType !== "session") throw new Error("Wrong tokenType");
    return payload as SessionClaims;
}

export async function signSecureToken(claims: Omit<SecureClaims, "tokenType">, ttlSeconds = 20) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ ...claims, tokenType: "secure" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + ttlSeconds)
        .sign(HS_SECRET);
}

export async function verifySecureToken(token: string): Promise<SecureClaims> {
    const { payload } = await jwtVerify(token, HS_SECRET, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.tokenType !== "secure") throw new Error("Wrong tokenType");
    return payload as SecureClaims;
}

// Helpers
export function getBearer(req: { headers: Record<string, any> }) {
    const h = req.headers["authorization"] || "";
    const [, token] = String(h).split(" ");
    return token || "";
}
export function sha256(input: string) {
    return crypto.createHash("sha256").update(input).digest("hex");
}
