import { PlatformRole } from "@prisma/client";
import { getOidcConfig } from "@/lib/auth-config";
import { clearOidcTransactionCookie, createSessionCookie, readOidcTransaction } from "@/lib/auth-session";
import { withDb } from "@/lib/db";
import { discoverOidc, exchangeAuthorizationCode, verifyIdToken } from "@/lib/oidc";

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
    const metadata = await discoverOidc(config.issuer);
    const redirectUri = config.redirectUri || `${origin}/api/auth/callback`;
    const tokenSet = await exchangeAuthorizationCode({ config, metadata, code, verifier: transaction.verifier, redirectUri });
    const payload = await verifyIdToken({ config, metadata, idToken: tokenSet.id_token!, nonce: transaction.nonce });
    const subject = payload.sub!;
    const email = identityEmail(payload as Record<string, unknown>);
    const displayName = identityName(payload as Record<string, unknown>, email, subject);

    const identity = await withDb(async (db) => {
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
      const jitAllowed = Boolean(config.jitProvisioning && domain && config.allowedEmailDomains.includes(domain));

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

      const person = email
        ? await db.person.findFirst({
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
        : null;

      return { user, employmentId: person?.employments[0]?.id };
    });

    const headers = new Headers({ location: transaction.returnTo, "cache-control": "no-store" });
    headers.append("set-cookie", createSessionCookie({
      tenantId: identity.user.tenantId,
      actorId: identity.user.id,
      role: identity.user.role,
      employmentId: identity.employmentId,
      displayName: identity.user.displayName,
      email: identity.user.email ?? undefined,
      subject: identity.user.subject
    }));
    headers.append("set-cookie", clearOidcTransactionCookie());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("OIDC callback failed", error);
    const code = error instanceof Error && error.message === "IDENTITY_NOT_PROVISIONED"
      ? "not-provisioned"
      : error instanceof Error && error.message === "IDENTITY_DISABLED"
        ? "disabled"
        : "callback";
    const headers = new Headers({ location: redirectWithError(origin, code), "cache-control": "no-store" });
    headers.append("set-cookie", clearOidcTransactionCookie());
    return new Response(null, { status: 302, headers });
  }
}
