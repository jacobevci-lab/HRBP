import { sanitizeReturnTo } from "@/lib/safe-redirect";
import { PlatformRole } from "@prisma/client";
import { getOidcConfig } from "@/lib/auth-config";
import { authenticationAssuranceVersion, evaluateOidcAssurance } from "@/lib/auth-assurance";
import { clearOidcTransactionCookie, createSessionCookie, readOidcTransaction } from "@/lib/auth-session";
import { withDb } from "@/lib/db";
import { discoverOidc, exchangeAuthorizationCode, verifyIdToken } from "@/lib/oidc";
import { enforceOidcRuntimeBinding } from "@/lib/runtime-identity-provider";

export const dynamic = "force-dynamic";

function identityEmail(payload: Record<string, unknown>) {
  const value = payload.email ?? payload.preferred_username ?? payload.upn;
  return typeof value === "string" && value.includes("@") ? value.trim().toLowerCase() : undefined;
}

function identityName(payload: Record<string, unknown>, email: string | undefined, subject: string) {
  return typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : (email || subject);
}

function redirectWithError(origin: string, code: string) {
  return `${origin}/auth/sign-in?error=${encodeURIComponent(code)}`;
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const config = getOidcConfig();
  const transaction = readOidcTransaction(request);
  const requestUrl = new URL(request.url);

  if (!config || !transaction) return Response.redirect(redirectWithError(origin, "transaction"), 302);
  if (requestUrl.searchParams.get("error")) return Response.redirect(redirectWithError(origin, "provider"), 302);

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state || state !== transaction.state) return Response.redirect(redirectWithError(origin, "state"), 302);

  try {
    const runtimeBinding = await withDb((db) => enforceOidcRuntimeBinding(db, config));
    const metadata = await discoverOidc(config.issuer);
    const redirectUri = config.redirectUri || `${origin}/api/auth/callback`;
    const tokenSet = await exchangeAuthorizationCode({ config, metadata, code, verifier: transaction.verifier, redirectUri });
    const payload = await verifyIdToken({ config, metadata, idToken: tokenSet.id_token!, nonce: transaction.nonce });
    const subject = payload.sub!;
    const email = identityEmail(payload as Record<string, unknown>);
    const displayName = identityName(payload as Record<string, unknown>, email, subject);
    const assurance = evaluateOidcAssurance(payload as Record<string, unknown>);
    const assuranceVersion = authenticationAssuranceVersion();
    if (runtimeBinding.managed && runtimeBinding.mfaRequired && !assurance.mfaSatisfied) {
      throw new Error("MFA_REQUIRED");
    }

    const identity = await withDb(async (db) => {
      const securityPolicy = await db.tenantSecurityPolicy.findUnique({
        where: { tenantId: config.tenantId },
        select: { sessionMaxMinutes: true, mfaRequired: true, deviceTrustRequired: true, assuranceEnforcedAt: true }
      });
      if (securityPolicy?.assuranceEnforcedAt && securityPolicy.mfaRequired && !assurance.mfaSatisfied) throw new Error("MFA_REQUIRED");
      if (securityPolicy?.assuranceEnforcedAt && securityPolicy.deviceTrustRequired && !assurance.deviceTrustSatisfied) throw new Error("DEVICE_TRUST_REQUIRED");
      let user = await db.userAccount.findFirst({
        where: {
          tenantId: config.tenantId,
          OR: [
            { subject },
            ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])
          ]
        }
      });

      const bootstrap = Boolean(email && config.bootstrapAdminEmail && email === config.bootstrapAdminEmail);
      const domain = email?.split("@")[1]?.toLowerCase();
      const jitEnabled = runtimeBinding.managed ? runtimeBinding.jitEnabled : config.jitProvisioning;
      const jitAllowed = Boolean(jitEnabled && domain && config.allowedEmailDomains.includes(domain));

      if (!user && bootstrap) {
        user = await db.userAccount.create({
          data: {
            tenantId: config.tenantId,
            subject,
            displayName,
            email,
            role: PlatformRole.TENANT_ADMIN,
            active: true
          }
        });
      } else if (!user && jitAllowed) {
        user = await db.userAccount.create({
          data: {
            tenantId: config.tenantId,
            subject,
            displayName,
            email,
            role: PlatformRole.EMPLOYEE,
            active: true
          }
        });
      }

      if (!user) throw new Error("IDENTITY_NOT_PROVISIONED");
      if (!user.active) throw new Error("IDENTITY_DISABLED");

      if (user.subject !== subject || user.displayName !== displayName || (email && user.email !== email)) {
        user = await db.userAccount.update({
          where: { id: user.id },
          data: { subject, displayName, email: email ?? user.email }
        });
      }

      const [person, tenant] = await Promise.all([
        email
          ? db.person.findFirst({
            where: { tenantId: config.tenantId, workEmail: { equals: email, mode: "insensitive" } },
            select: {
              employments: {
                where: { status: { not: "TERMINATED" } },
                orderBy: { startDate: "desc" },
                take: 1,
                select: { id: true }
              }
            }
            })
          : Promise.resolve(null),
        db.tenant.findUnique({ where: { id: config.tenantId }, select: { sessionVersion: true } })
      ]);
      if (!tenant) throw new Error("TENANT_NOT_FOUND");

      return {
        user,
        employmentId: person?.employments[0]?.id,
        tenantSessionVersion: tenant.sessionVersion,
        sessionMaxMinutes: securityPolicy?.sessionMaxMinutes ?? 480
      };
    });

    const headers = new Headers({ location: sanitizeReturnTo(transaction.returnTo), "cache-control": "no-store" });
    headers.append("set-cookie", createSessionCookie({
      authMethod: "oidc",
      accountSessionVersion: identity.user.sessionVersion,
      tenantSessionVersion: identity.tenantSessionVersion,
      mfaSatisfied: assurance.mfaSatisfied,
      deviceTrustSatisfied: assurance.deviceTrustSatisfied,
      assuranceVersion,
      tenantId: identity.user.tenantId,
      actorId: identity.user.id,
      role: identity.user.role,
      employmentId: identity.employmentId,
      displayName: identity.user.displayName,
      email: identity.user.email ?? undefined,
      subject: identity.user.subject
    }, identity.sessionMaxMinutes));
    headers.append("set-cookie", clearOidcTransactionCookie());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("OIDC callback failed", error);
    const code = error instanceof Error && (
      error.message === "IDENTITY_PROVIDER_AMBIGUOUS" ||
      error.message === "IDENTITY_PROVIDER_DRIFT" ||
      error.message === "IDENTITY_PROVIDER_INACTIVE"
    )
      ? "configuration"
      : error instanceof Error && error.message === "IDENTITY_NOT_PROVISIONED"
      ? "not-provisioned"
      : error instanceof Error && error.message === "IDENTITY_DISABLED"
        ? "disabled"
        : error instanceof Error && error.message === "MFA_REQUIRED"
          ? "mfa-required"
          : error instanceof Error && error.message === "DEVICE_TRUST_REQUIRED"
            ? "device-trust-required"
            : "callback";
    const headers = new Headers({ location: redirectWithError(origin, code), "cache-control": "no-store" });
    headers.append("set-cookie", clearOidcTransactionCookie());
    return new Response(null, { status: 302, headers });
  }
}
