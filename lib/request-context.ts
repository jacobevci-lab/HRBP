import { PlatformRole } from "@prisma/client";

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
 * Legacy header context exists only for local development and automated testing.
 * Production must populate RequestContext from a cryptographically verified
 * identity/session layer rather than trusting caller-supplied role headers.
 */
function insecureHeaderContextAllowed() {
  return process.env.NODE_ENV !== "production" && process.env.HRBP_ALLOW_INSECURE_CONTEXT_HEADERS === "true";
}

export function getRequestContext(request: Request): RequestContext | null {
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

export function unauthorized() {
  return Response.json({ error: "Authenticated identity context is required." }, { status: 401 });
}
