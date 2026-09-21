import { PlatformRole } from "@prisma/client";
import { sessionFromRequest } from "@/lib/auth-session";

export type RequestContext = {
  tenantId: string;
  actorId: string;
  role: PlatformRole;
  employmentId?: string;
  purpose?: string;
  ipAddress?: string;
};

const validRoles = new Set(Object.values(PlatformRole));

/**
 * Caller-supplied role headers are accepted only for explicit local development
 * and automated testing. Production identity comes from the HMAC-signed HRBP
 * session created after OIDC validation.
 */
function insecureHeaderContextAllowed() {
  return process.env.NODE_ENV !== "production" && process.env.HRBP_ALLOW_INSECURE_CONTEXT_HEADERS === "true";
}

export function getRequestContext(request: Request): RequestContext | null {
  const session = sessionFromRequest(request);
  if (session) {
    return {
      tenantId: session.tenantId,
      actorId: session.actorId,
      role: session.role,
      employmentId: session.employmentId,
      purpose: request.headers.get("x-purpose")?.trim() || undefined,
      ipAddress: request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined
    };
  }

  if (!insecureHeaderContextAllowed()) return null;

  const tenantId = request.headers.get("x-tenant-id")?.trim();
  const actorId = request.headers.get("x-user-id")?.trim();
  const roleValue = request.headers.get("x-role")?.trim() as PlatformRole | undefined;
  if (!tenantId || !actorId || !roleValue || !validRoles.has(roleValue)) return null;

  return {
    tenantId,
    actorId,
    role: roleValue,
    employmentId: request.headers.get("x-employment-id")?.trim() || undefined,
    purpose: request.headers.get("x-purpose")?.trim() || undefined,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined
  };
}

/**
 * SameSite cookies are the primary CSRF boundary. Mutations also enforce the
 * browser Origin header when one is present so a sibling/untrusted origin
 * cannot silently reuse an authenticated session.
 */
export function mutationOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function unauthorized() {
  return Response.json({ error: "Authenticated identity context is required." }, { status: 401 });
}
