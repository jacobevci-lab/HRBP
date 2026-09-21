import { DataClassification, PlatformRole } from "@prisma/client";
import type { RequestContext } from "@/lib/request-context";

export type Capability =
  | "people:read" | "people:write"
  | "organization:read" | "organization:write"
  | "positions:read" | "positions:write"
  | "documents:read" | "documents:write"
  | "audit:read" | "cases:read";

const grants: Record<PlatformRole, Capability[]> = {
  EMPLOYEE: ["people:read", "documents:read"],
  MANAGER: ["people:read", "organization:read", "positions:read", "documents:read"],
  HRBP: ["people:read", "people:write", "organization:read", "positions:read", "documents:read"],
  HR_OPERATIONS: ["people:read", "people:write", "organization:read", "organization:write", "positions:read", "positions:write", "documents:read", "documents:write"],
  TALENT_ADMIN: ["people:read", "organization:read", "positions:read"],
  COMPENSATION_ADMIN: ["people:read", "organization:read", "positions:read"],
  ER_INVESTIGATOR: ["people:read", "cases:read", "documents:read", "documents:write"],
  LEGAL: ["people:read", "cases:read", "documents:read", "audit:read"],
  PRIVACY_OFFICER: ["people:read", "documents:read", "audit:read"],
  SECURITY_AUDITOR: ["audit:read"],
  TENANT_ADMIN: ["people:read", "people:write", "organization:read", "organization:write", "positions:read", "positions:write", "documents:read", "documents:write", "audit:read"]
};

export function can(ctx: RequestContext, capability: Capability) {
  return grants[ctx.role].includes(capability);
}

export function canReadClassification(ctx: RequestContext, classification: DataClassification) {
  if (classification !== DataClassification.HIGHLY_RESTRICTED) return true;
  return [PlatformRole.ER_INVESTIGATOR, PlatformRole.LEGAL, PlatformRole.PRIVACY_OFFICER].includes(ctx.role);
}

export function forbidden(message = "Access denied by policy.") {
  return Response.json({ error: message }, { status: 403 });
}
