import { cache } from "react";
import { verifySessionAccount } from "@/lib/verified-session";
import { cookies } from "next/headers";
import { decodeSignedPayload, SESSION_COOKIE, sessionSecret, type SessionClaims } from "@/lib/auth-session";
import type { RequestContext } from "@/lib/request-context";
import { resolveEmergencyAccess } from "@/lib/emergency-access";



/**
 * Server Components cannot construct a Request object just to resolve the
 * authenticated principal. This helper validates the same HMAC-signed session
 * cookie used by API routes and projects it into the shared authorization
 * context without trusting browser-supplied headers.
 */
const resolveServerSessionClaims = cache(async (): Promise<SessionClaims | null> => {
  const secret = sessionSecret();
  if (!secret) return null;

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const claims = decodeSignedPayload<SessionClaims>(token, secret);
  return verifySessionAccount(claims);
});

export async function getServerSessionClaims(): Promise<SessionClaims | null> {
  return resolveServerSessionClaims();
}

export async function getServerRequestContext(): Promise<RequestContext | null> {
  const claims = await getServerSessionClaims();
  if (!claims) return null;
  const emergency = await resolveEmergencyAccess({
    tenantId: claims.tenantId,
    actorId: claims.actorId,
    role: claims.role
  });
  return {
    tenantId: claims.tenantId,
    actorId: claims.actorId,
    role: claims.role,
    employmentId: claims.employmentId,
    mfaSatisfied: claims.mfaSatisfied === true,
    deviceTrustSatisfied: claims.deviceTrustSatisfied === true,
    assuranceVersion: claims.assuranceVersion ?? null,
    ...emergency
  };
}
