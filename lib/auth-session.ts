import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PlatformRole } from "@prisma/client";
import { runtimeNumber, runtimeString } from "@/lib/runtime-env";

export const SESSION_COOKIE = "hrbp_session";
export const OIDC_TRANSACTION_COOKIE = "hrbp_oidc_txn";

export type SessionClaims = {
  v: 1;
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
  if (!token) return null;
  const [segment, suppliedSignature] = token.split(".");
  if (!segment || !suppliedSignature) return null;

  const expected = Buffer.from(signature(segment, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
    if (value.exp && value.exp <= Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch {
    return null;
  }
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

export function sanitizeReturnTo(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((result, part) => {
    const index = part.indexOf("=");
    if (index <= 0) return result;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
    return result;
  }, {});
}

export function sessionFromRequest(request: Request): SessionClaims | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const cookies = parseCookies(request.headers.get("cookie"));
  const claims = decodeSignedPayload<SessionClaims>(cookies[SESSION_COOKIE], secret);
  if (!claims || claims.v !== 1 || !claims.tenantId || !claims.actorId || !claims.subject || !validRoles.has(claims.role)) return null;
  return claims;
}

function cookieBase(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function createSessionCookie(claims: Omit<SessionClaims, "v" | "issuedAt" | "exp">) {
  const secret = sessionSecret();
  if (!secret) throw new Error("HRBP_SESSION_SECRET must contain at least 32 characters.");
  const issuedAt = Math.floor(Date.now() / 1000);
  const ttlHours = Math.min(Math.max(runtimeNumber("HRBP_SESSION_TTL_HOURS", 8), 1), 24);
  const exp = issuedAt + ttlHours * 60 * 60;
  const token = encodeSignedPayload({ ...claims, v: 1, issuedAt, exp } satisfies SessionClaims, secret);
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
