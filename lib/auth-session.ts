import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PlatformRole } from "@prisma/client";
import { runtimeNumber, runtimeString } from "@/lib/runtime-env";

export { sanitizeReturnTo } from "@/lib/safe-redirect";

export const SESSION_COOKIE = "hrbp_session";
export const OIDC_TRANSACTION_COOKIE = "hrbp_oidc_txn";

export type SessionClaims = {
  v: 2;
  authMethod?: "local" | "oidc";
  credentialVersion?: string | null;
  accountSessionVersion: number;
  tenantSessionVersion: number;
  mfaSatisfied?: boolean;
  deviceTrustSatisfied?: boolean;
  assuranceVersion?: string | null;
  tenantId: string;
  actorId: string;
  role: PlatformRole;
  employmentId?: string;
  displayName: string;
  email?: string;
  subject: string;
  issuedAt: number;
  exp: number;
};

export type OidcTransaction = {
  v: 1;
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
};

const validRoles = new Set(Object.values(PlatformRole));

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function signature(segment: string, secret: string) {
  return createHmac("sha256", secret).update(segment).digest("base64url");
}

export function encodeSignedPayload(payload: object, secret: string) {
  const segment = base64Url(JSON.stringify(payload));
  return `${segment}.${signature(segment, secret)}`;
}

export function decodeSignedPayload<T extends { exp?: number }>(token: string | undefined, secret: string): T | null {
  if (!token || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [segment, suppliedSignature] = token.split(".");
  const expected = Buffer.from(signature(segment, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const exp = (value as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    return value as T;
  } catch { return null; }
}

export function sessionSecret(): string | undefined {
  const secret = runtimeString("HRBP_SESSION_SECRET");
  return secret && secret.length >= 32 ? secret : undefined;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Ignore malformed unrelated cookies, and reject ambiguous duplicate cookie names. */
export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!header || header.length > 16384) return result;
  const seen = new Set<string>();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (!key || seen.has(key)) { delete result[key]; continue; }
    seen.add(key);
    try { result[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Invalid cookie, not a server error. */ }
  }
  return result;
}

export function validSessionClaims(claims: SessionClaims | null): claims is SessionClaims {
  if (!claims || claims.v !== 2 || !validRoles.has(claims.role)) return false;
  const required = [claims.tenantId, claims.actorId, claims.subject, claims.displayName];
  if (required.some((value) => typeof value !== "string" || !value || value.length > 512)) return false;
  if (claims.employmentId !== undefined && (typeof claims.employmentId !== "string" || !claims.employmentId || claims.employmentId.length > 191)) return false;
  if (claims.email !== undefined && (typeof claims.email !== "string" || claims.email.length > 512)) return false;
  if (!Number.isSafeInteger(claims.accountSessionVersion) || claims.accountSessionVersion < 1 ||
      !Number.isSafeInteger(claims.tenantSessionVersion) || claims.tenantSessionVersion < 1) return false;
  if (claims.mfaSatisfied !== undefined && typeof claims.mfaSatisfied !== "boolean") return false;
  if (claims.deviceTrustSatisfied !== undefined && typeof claims.deviceTrustSatisfied !== "boolean") return false;
  if (claims.assuranceVersion !== undefined && claims.assuranceVersion !== null && !/^[a-f0-9]{64}$/.test(claims.assuranceVersion)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Number.isSafeInteger(claims.issuedAt) && Number.isSafeInteger(claims.exp) &&
    claims.issuedAt <= now + 60 && claims.exp > now && claims.exp > claims.issuedAt && claims.exp - claims.issuedAt <= 86400;
}

export function sessionFromRequest(request: Request): SessionClaims | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const cookies = parseCookies(request.headers.get("cookie"));
  const claims = decodeSignedPayload<SessionClaims>(cookies[SESSION_COOKIE], secret);
  if (!validSessionClaims(claims)) return null;
  return claims;
}

function cookieBase(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function effectiveSessionMaxMinutes(tenantMinutes: number | null | undefined) {
  const platformMinutes = Math.floor(Math.min(Math.max(runtimeNumber("HRBP_SESSION_TTL_HOURS", 8), 1), 24) * 60);
  const boundedTenant = Number.isInteger(tenantMinutes) && (tenantMinutes as number) >= 15 && (tenantMinutes as number) <= 1440
    ? tenantMinutes as number
    : 480;
  return Math.min(platformMinutes, boundedTenant);
}

export function createSessionCookie(
  claims: Omit<SessionClaims, "v" | "issuedAt" | "exp">,
  tenantSessionMaxMinutes?: number | null
) {
  const secret = sessionSecret();
  if (!secret) throw new Error("HRBP_SESSION_SECRET must contain at least 32 characters.");
  const issuedAt = Math.floor(Date.now() / 1000);
  const ttlMinutes = effectiveSessionMaxMinutes(tenantSessionMaxMinutes);
  const exp = issuedAt + ttlMinutes * 60;
  const token = encodeSignedPayload({ ...claims, authMethod: claims.authMethod ?? "oidc", v: 2, issuedAt, exp } satisfies SessionClaims, secret);
  return cookieBase(SESSION_COOKIE, token, exp - issuedAt);
}

export function clearSessionCookie() {
  return cookieBase(SESSION_COOKIE, "", 0);
}

export function createOidcTransactionCookie(transaction: Omit<OidcTransaction, "v" | "exp">) {
  const secret = sessionSecret();
  if (!secret) throw new Error("HRBP_SESSION_SECRET must contain at least 32 characters.");
  const exp = Math.floor(Date.now() / 1000) + 10 * 60;
  return cookieBase(OIDC_TRANSACTION_COOKIE, encodeSignedPayload({ ...transaction, v: 1, exp } satisfies OidcTransaction, secret), 10 * 60);
}

export function readOidcTransaction(request: Request): OidcTransaction | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const cookies = parseCookies(request.headers.get("cookie"));
  const transaction = decodeSignedPayload<OidcTransaction>(cookies[OIDC_TRANSACTION_COOKIE], secret);
  return transaction?.v === 1 ? transaction : null;
}

export function clearOidcTransactionCookie() {
  return cookieBase(OIDC_TRANSACTION_COOKIE, "", 0);
}
