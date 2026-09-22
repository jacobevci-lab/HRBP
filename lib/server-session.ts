import { PlatformRole } from "@prisma/client";
import { cookies } from "next/headers";
import { decodeSignedPayload, SESSION_COOKIE, sessionSecret, type SessionClaims } from "@/lib/auth-session";
import type { RequestContext } from "@/lib/request-context";

const validRoles = new Set(Object.values(PlatformRole));

/**
 * Server Components cannot construct a Request object just to resolve the
 * authenticated principal. This helper validates the same HMAC-signed session
 * cookie used by API routes and projects it into the shared authorization
 * context without trusting browser-supplied headers.
 */
export async function getServerSessionClaims(): Promise<SessionClaims | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const claims = decodeSignedPayload<SessionClaims>(token, secret);
  if (!claims || claims.v !== 1 || !claims.tenantId || !claims.actorId || !claims.subject || !validRoles.has(claims.role)) return null;
  return claims;
}

export async function getServerRequestContext(): Promise<RequestContext | null> {
  const claims = await getServerSessionClaims();
  if (!claims) return null;
  return {
    tenantId: claims.tenantId,
    actorId: claims.actorId,
    role: claims.role,
    employmentId: claims.employmentId
  };
}
