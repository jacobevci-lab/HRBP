import { authenticationAssuranceVersion } from "@/lib/auth-assurance";
import { effectiveSessionMaxMinutes, type SessionClaims, validSessionClaims } from "@/lib/auth-session";
import { db } from "@/lib/db";

/** No cross-request cache: revocation/role/password/policy changes take effect on the next request. */
export async function verifySessionAccount(claims: SessionClaims | null): Promise<SessionClaims | null> {
  if (!validSessionClaims(claims)) return null;
  // Legacy sessions cannot tell local credentials from OIDC. Require one new sign-in.
  if (claims.authMethod !== "local" && claims.authMethod !== "oidc") return null;
  try {
    const [user, policy] = await Promise.all([
      db.userAccount.findFirst({
        where: { id: claims.actorId, tenantId: claims.tenantId, active: true },
        select: {
          id: true, subject: true, role: true, email: true, localAuthEnabled: true,
          localPasswordUpdatedAt: true, sessionVersion: true,
          tenant: { select: { sessionVersion: true } }
        }
      }),
      db.tenantSecurityPolicy.findUnique({
        where: { tenantId: claims.tenantId },
        select: { sessionMaxMinutes: true, mfaRequired: true, deviceTrustRequired: true, assuranceEnforcedAt: true }
      })
    ]);
    if (!user || user.subject !== claims.subject || user.role !== claims.role ||
        (user.email ?? undefined) !== claims.email) return null;
    if (claims.accountSessionVersion !== user.sessionVersion ||
        claims.tenantSessionVersion !== user.tenant.sessionVersion) return null;
    if (policy?.assuranceEnforcedAt && policy.mfaRequired && claims.mfaSatisfied !== true) return null;
    if (policy?.assuranceEnforcedAt && policy.deviceTrustRequired && claims.deviceTrustSatisfied !== true) return null;
    if (policy?.assuranceEnforcedAt && claims.authMethod === "oidc" && claims.assuranceVersion !== authenticationAssuranceVersion()) return null;
    const maxMinutes = effectiveSessionMaxMinutes(policy?.sessionMaxMinutes);
    if (claims.issuedAt + maxMinutes * 60 <= Math.floor(Date.now() / 1000)) return null;
    if (claims.authMethod === "local" && (!user.localAuthEnabled ||
        claims.credentialVersion !== (user.localPasswordUpdatedAt?.toISOString() ?? null))) return null;
    if (claims.employmentId) {
      const employment = await db.employment.findFirst({
        where: { id: claims.employmentId, tenantId: claims.tenantId, status: { not: "TERMINATED" },
          person: { tenantId: claims.tenantId, workEmail: { equals: user.email ?? "", mode: "insensitive" } } },
        select: { id: true }
      });
      if (!user.email || !employment) return null;
    }
    return claims;
  } catch {
    // Fail closed; never echo database errors or accept a stale principal on outage.
    console.error("[HRBP] Session account verification unavailable.");
    return null;
  }
}
