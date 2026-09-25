import { DataClassification, PlatformRole } from "@prisma/client";
import type { RequestContext } from "@/lib/request-context";

export type Capability =
  | "people:read" | "people:write"
  | "organization:read" | "organization:write"
  | "positions:read" | "positions:write"
  | "documents:read" | "documents:write" | "documents:sign" | "documents:grant" | "documents:govern"
  | "recruiting:read" | "recruiting:write" | "recruiting:approve"
  | "onboarding:read" | "onboarding:write"
  | "offboarding:read" | "offboarding:write"
  | "time:read" | "time:write" | "time:self-entry" | "time:approve" | "time:lock" | "time:configure"
  | "leave:read" | "leave:write" | "leave:self-request" | "leave:approve" | "leave:configure"
  | "compensation:read" | "compensation:write" | "compensation:propose" | "compensation:approve" | "compensation:apply"
  | "payroll:read" | "payroll:write" | "payroll:self-payslip" | "payroll:prepare" | "payroll:approve" | "payroll:pay" | "payroll:configure"
  | "benefits:read" | "benefits:write"
  | "performance:read" | "performance:write" | "performance:self-submit" | "performance:manager-review" | "performance:goal-progress"
  | "talent:read" | "talent:write"
  | "succession:read" | "succession:write"
  | "learning:read" | "learning:write" | "learning:self-progress"
  | "cases:read" | "cases:write"
  | "hr-service:read" | "hr-service:write"
  | "policies:read" | "policies:write" | "policies:approve" | "policies:acknowledge"
  | "engagement:read" | "engagement:write"
  | "workforce-plan:read" | "workforce-plan:write"
  | "analytics:read"
  | "ai:use"
  | "privacy:read" | "privacy:write"
  | "workflows:read" | "workflows:write" | "workflows:run"
  | "settings:read" | "settings:write"
  | "audit:read";

const grants: Record<PlatformRole, Capability[]> = {
  EMPLOYEE: [
    "people:read", "documents:read", "onboarding:read",
    "time:read", "time:self-entry", "leave:read", "leave:self-request",
    "payroll:self-payslip",
    "performance:read", "performance:self-submit", "performance:goal-progress",
    "learning:read", "learning:self-progress",
    "hr-service:read", "hr-service:write",
    "policies:read", "policies:acknowledge", "engagement:read", "ai:use"
  ],
  MANAGER: [
    "people:read", "organization:read", "positions:read", "documents:read",
    "recruiting:read", "onboarding:read", "offboarding:read",
    "time:read", "time:self-entry", "time:approve", "leave:read", "leave:self-request", "leave:approve",
    "payroll:self-payslip",
    "performance:read", "performance:self-submit", "performance:manager-review", "performance:goal-progress",
    "learning:read", "learning:self-progress",
    "hr-service:read", "hr-service:write",
    "policies:read", "policies:acknowledge", "engagement:read", "analytics:read", "ai:use"
  ],
  HRBP: [
    "people:read", "people:write", "organization:read", "positions:read",
    "documents:read", "documents:write", "documents:sign",
    "recruiting:read", "recruiting:write", "recruiting:approve", "onboarding:read", "onboarding:write",
    "offboarding:read", "offboarding:write",
    "time:read", "leave:read", "leave:write", "leave:self-request", "leave:approve",
    "compensation:read", "compensation:propose", "payroll:self-payslip", "benefits:read",
    "performance:read", "performance:write", "performance:self-submit", "performance:manager-review", "performance:goal-progress",
    "talent:read", "talent:write", "succession:read", "succession:write", "learning:read", "learning:self-progress",
    "hr-service:read", "hr-service:write", "policies:read",
    "engagement:read", "engagement:write",
    "workforce-plan:read", "workforce-plan:write", "analytics:read", "ai:use",
    "workflows:read", "workflows:run"
  ],
  HR_OPERATIONS: [
    "people:read", "people:write", "organization:read", "organization:write",
    "positions:read", "positions:write",
    "documents:read", "documents:write", "documents:sign", "documents:grant", "documents:govern",
    "recruiting:read", "recruiting:write", "recruiting:approve", "onboarding:read", "onboarding:write",
    "offboarding:read", "offboarding:write",
    "time:read", "time:write", "time:self-entry", "time:approve", "time:lock", "time:configure",
    "leave:read", "leave:write", "leave:self-request", "leave:approve", "leave:configure", "compensation:read", "payroll:self-payslip", "benefits:read", "benefits:write",
    "performance:read", "performance:self-submit", "performance:manager-review", "performance:goal-progress",
    "learning:read", "learning:write", "learning:self-progress",
    "hr-service:read", "hr-service:write",
    "policies:read", "policies:write", "policies:approve",
    "engagement:read", "engagement:write", "workforce-plan:read", "workforce-plan:write",
    "analytics:read", "ai:use",
    "workflows:read", "workflows:write", "workflows:run", "settings:read"
  ],
  RECRUITER: [
    "people:read", "organization:read", "positions:read", "documents:read",
    "recruiting:read", "recruiting:write", "onboarding:read", "payroll:self-payslip", "policies:read", "ai:use"
  ],
  TIME_ADMIN: [
    "people:read", "organization:read",
    "time:read", "time:write", "time:self-entry", "time:approve", "time:lock", "time:configure",
    "leave:read", "leave:write", "leave:self-request", "leave:approve", "leave:configure", "payroll:self-payslip", "policies:read"
  ],
  TALENT_ADMIN: [
    "people:read", "organization:read", "positions:read",
    "payroll:self-payslip",
    "performance:read", "performance:write", "performance:self-submit", "performance:manager-review", "performance:goal-progress",
    "talent:read", "talent:write", "succession:read", "succession:write", "learning:read", "learning:write", "learning:self-progress",
    "policies:read", "engagement:read", "engagement:write", "analytics:read", "ai:use"
  ],
  COMPENSATION_ADMIN: [
    "people:read", "organization:read", "positions:read",
    "compensation:read", "compensation:propose", "compensation:approve", "compensation:apply", "payroll:read", "payroll:self-payslip", "benefits:read",
    "policies:read", "analytics:read"
  ],
  PAYROLL_ADMIN: [
    "people:read", "organization:read", "time:read", "leave:read",
    "compensation:read", "payroll:read", "payroll:self-payslip", "payroll:prepare", "payroll:approve", "payroll:pay", "payroll:configure",
    "benefits:read", "offboarding:read", "policies:read"
  ],
  ER_INVESTIGATOR: [
    "people:read", "cases:read", "cases:write", "documents:read", "documents:write", "payroll:self-payslip", "policies:read"
  ],
  LEGAL: [
    "people:read", "cases:read",
    "documents:read", "documents:write", "documents:sign", "documents:grant", "documents:govern",
    "payroll:self-payslip",
    "policies:read", "policies:write", "policies:approve",
    "privacy:read", "audit:read"
  ],
  PRIVACY_OFFICER: [
    "people:read", "cases:read", "documents:read", "payroll:self-payslip", "policies:read",
    "privacy:read", "privacy:write", "audit:read"
  ],
  SECURITY_AUDITOR: ["payroll:self-payslip", "settings:read", "audit:read"],
  TENANT_ADMIN: [
    "people:read", "people:write", "organization:read", "organization:write",
    "positions:read", "positions:write", "documents:read", "documents:write",
    "recruiting:read", "recruiting:write", "recruiting:approve", "onboarding:read", "onboarding:write",
    "offboarding:read", "time:read", "time:configure", "leave:read", "leave:write", "leave:self-request", "leave:approve", "leave:configure",
    "payroll:self-payslip", "benefits:read", "performance:read", "performance:self-submit", "performance:manager-review", "performance:goal-progress",
    "talent:read", "succession:read", "learning:read", "learning:self-progress",
    "hr-service:read", "hr-service:write", "policies:read", "engagement:read",
    "workforce-plan:read", "analytics:read", "ai:use",
    "workflows:read", "workflows:write", "settings:read", "settings:write", "audit:read"
  ]
};

const highlyRestrictedReaders = new Set<PlatformRole>([
  PlatformRole.ER_INVESTIGATOR,
  PlatformRole.LEGAL,
  PlatformRole.PRIVACY_OFFICER
]);

export function can(ctx: RequestContext, capability: Capability) {
  // Deprecated UI compatibility aliases. Domain APIs must use granular capabilities.
  if (capability === "compensation:write") return grants[ctx.role].includes("compensation:propose");
  if (capability === "payroll:write") return grants[ctx.role].includes("payroll:prepare");
  return grants[ctx.role].includes(capability);
}

export function canReadClassification(ctx: RequestContext, classification: DataClassification) {
  if (classification !== DataClassification.HIGHLY_RESTRICTED) return true;
  return highlyRestrictedReaders.has(ctx.role);
}

export function forbidden(message = "Access denied by policy.") {
  return Response.json({ error: message }, { status: 403 });
}
