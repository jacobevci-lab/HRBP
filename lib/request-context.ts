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

export function getRequestContext(request: Request): RequestContext | null {
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
  return Response.json({ error: "Missing or invalid trusted identity context." }, { status: 401 });
}
