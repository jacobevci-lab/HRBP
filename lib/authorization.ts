import { DataClassification, PlatformRole } from "@prisma/client";
import type { RequestContext } from "@/lib/request-context";

export type Capability =
  | "people:read" | "people:write"
  | "organization:read" | "organization:write"
  | "positions:read" | "positions:write"
  | "documents:read" | "documents:write"
  | "recruiting:read" | "recruiting:write"
  | "onboarding:read" | "onboarding:write"
  | "time:read" | "time:write"
  | "leave:read" | "leave:write"
  | "compensation:read" | "compensation:write"
  | "payroll:read" | "payroll:write"
  | "audit:read" | "cases:read";

const grants: Record<PlatformRole, Capability[]> = {
  EMPLOYEE: ["people:read", "documents:read", "onboarding:read", "time:read", "leave:read"],
  MANAGER: ["people:read", "organization:read", "positions:read", "documents:read", "recruiting:read", "onboarding:read", "time:read", "time:write", "leave:read", "leave:write"],
  HRBP: ["people:read", "people:write", "organization:read", "positions:read", "documents:read", "recruiting:read", "recruiting:write", "onboarding:read", "onboarding:write", "time:read", "leave:read", "leave:write", "compensation:read"],
  HR_OPERATIONS: ["people:read", "people:write", "organization:read", "organization:write", "positions:read", "positions:write", "documents:read", "documents:write", "recruiting:read", "recruiting:write", "onboarding:read", "onboarding:write", "time:read", "time:write", "leave:read", "leave:write", "compensation:read"],
  RECRUITER: ["people:read", "organization:read", "positions:read", "recruiting:read", "recruiting:write", "onboarding:read"],
  TIME_ADMIN: ["people:read", "organization:read", "time:read", "time:write", "leave:read", "leave:write"],
  TALENT_ADMIN: ["people:read", "organization:read", "positions:read"],
  COMPENSATION_ADMIN: ["people:read", "organization:read", "positions:read", "compensation:read", "compensation:write", "payroll:read"],
  PAYROLL_ADMIN: ["people:read", "organization:read", "time:read", "leave:read", "compensation:read", "payroll:read", "payroll:write"],
  ER_INVESTIGATOR: ["people:read", "cases:read", "documents:read", "documents:write"],
  LEGAL: ["people:read", "cases:read", "documents:read", "audit:read"],
  PRIVACY_OFFICER: ["people:read", "documents:read", "audit:read"],
  SECURITY_AUDITOR: ["audit:read"],
  TENANT_ADMIN: ["people:read", "people:write", "organization:read", "organization:write", "positions:read", "positions:write", "documents:read", "documents:write", "recruiting:read", "recruiting:write", "onboarding:read", "onboarding:write", "time:read", "time:write", "leave:read", "leave:write", "audit:read"]
};

const highlyRestrictedReaders = new Set<PlatformRole>([
  PlatformRole.ER_INVESTIGATOR,
  PlatformRole.LEGAL,
  PlatformRole.PRIVACY_OFFICER
]);

export function can(ctx: RequestContext, capability: Capability) {
  return grants[ctx.role].includes(capability);
}

export function canReadClassification(ctx: RequestContext, classification: DataClassification) {
  if (classification !== DataClassification.HIGHLY_RESTRICTED) return true;
  return highlyRestrictedReaders.has(ctx.role);
}

export function forbidden(message = "Access denied by policy.") {
  return Response.json({ error: message }, { status: 403 });
}
