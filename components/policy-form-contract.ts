/** Browser contracts only. Authorization and concurrency remain server-owned. */
export type EmploymentOption = {
  id: string; employeeNumber: string | null; name: string; position: string;
  organization: string; assigned: boolean; assignmentStatus: string | null; dueAt: string | null;
};
export type AssignmentOptions = { policyId: string; tenantId: string; relationshipScoped: boolean; employments: EmploymentOption[] };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128 && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 2000;

export function parseAssignmentOptions(value: unknown, policyId: string, tenantId: string): AssignmentOptions | null {
  if (!record(value) || value.policyId !== policyId || value.tenantId !== tenantId || typeof value.relationshipScoped !== "boolean" || !Array.isArray(value.employments) || value.employments.length > 500) return null;
  const seen = new Set<string>();
  for (const e of value.employments) {
    if (!record(e) || !id(e.id) || seen.has(e.id) || !text(e.name) || !text(e.position) || !text(e.organization) || !(e.employeeNumber === null || text(e.employeeNumber)) || typeof e.assigned !== "boolean" || !(e.dueAt === null || date(e.dueAt))) return null;
    if (e.assigned ? typeof e.assignmentStatus !== "string" || !["PENDING", "OVERDUE", "ACKNOWLEDGED", "WAIVED"].includes(e.assignmentStatus) : e.assignmentStatus !== null) return null;
    seen.add(e.id);
  }
  return { policyId, tenantId, relationshipScoped: value.relationshipScoped, employments: value.employments as EmploymentOption[] };
}
export type AssignmentRequest = { employmentIds: readonly string[]; dueAt: string | null };
export type ExceptionRequest = { reason: string; compensatingControl: string | null; expiresAt: string | null };

/** Counts alone cannot bind a success to the selected batch. The owning route
 * returns its validated, sorted request, not an assertion that skipped existing
 * assignments had their deadline rewritten. Compare without mutating the draft. */
export function acceptsAssignmentReceipt(value: unknown, policyId: string, tenantId: string, requested: number, expected: AssignmentRequest) {
  if (!record(value) || value.policyId !== policyId || value.tenantId !== tenantId || value.requested !== requested || !Number.isSafeInteger(requested) || requested < 1 || requested > 500) return false;
  if (!expected || !Array.isArray(expected.employmentIds) || expected.employmentIds.length !== requested || !expected.employmentIds.every(id) || new Set(expected.employmentIds).size !== requested || !(expected.dueAt === null || date(expected.dueAt))) return false;
  const actual = value.request;
  if (!record(actual) || !Array.isArray(actual.employmentIds) || actual.employmentIds.length !== requested || actual.dueAt !== expected.dueAt) return false;
  const selected = [...expected.employmentIds].sort();
  if (!actual.employmentIds.every((value, index) => id(value) && value === selected[index])) return false;
  const { assigned, skippedExisting } = value;
  return typeof assigned === "number" && Number.isSafeInteger(assigned) && assigned >= 0 && typeof skippedExisting === "number" && Number.isSafeInteger(skippedExisting) && skippedExisting >= 0 && assigned + skippedExisting === requested;
}

/** Match the persisted request fields as well as its policy/principal. An older
 * request for the same employee with different text/expiry is not confirmation
 * of this form. This is receipt checking, not a signed or immutable attestation. */
export function acceptsExceptionRequest(value: unknown, policyId: string, tenantId: string, actorId: string, employmentId: string, expected: ExceptionRequest) {
  if (!expected || !text(expected.reason) || !expected.reason.trim() || expected.reason !== expected.reason.trim() || !(expected.compensatingControl === null || (text(expected.compensatingControl) && expected.compensatingControl.trim() === expected.compensatingControl)) || !(expected.expiresAt === null || date(expected.expiresAt))) return false;
  return record(value) && id(value.id) && value.policyId === policyId && value.tenantId === tenantId && value.requestedById === actorId && value.employmentId === employmentId && value.status === "REQUESTED" && value.active === false && date(value.createdAt) && value.reason === expected.reason && value.compensatingControl === expected.compensatingControl && value.expiresAt === expected.expiresAt;
}
export function acceptsExceptionDecision(value: unknown, policyId: string, exceptionId: string, tenantId: string, actorId: string, decision: "APPROVE" | "REJECT") {
  return record(value) && value.id === exceptionId && value.policyId === policyId && value.tenantId === tenantId && value.approvedById === actorId && value.status === (decision === "APPROVE" ? "APPROVED" : "REJECTED") && value.active === (decision === "APPROVE") && date(value.decidedAt);
}
/** Keep the existing assignment UTC end-of-day contract explicit in both forms.
 * Empty means no deadline; false means malformed, normalized or already elapsed. */
export function futureUtcDayEnd(value: string, now = Date.now()): string | null | false {
  if (value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const result = new Date(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value || result.getTime() <= now) return false;
  return result.toISOString();
}
export function defaultPolicyDueDate() { return new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10); }
export function assignmentStatusText(status: string | null, locale: string) {
  const labels: Record<string, [string, string]> = { PENDING: ["Pending", "Bekliyor"], OVERDUE: ["Overdue", "Gecikmiş"], ACKNOWLEDGED: ["Acknowledged", "Okundu / onaylandı"], WAIVED: ["Waived", "Muaf"] };
  return labels[status ?? ""]?.[locale === "tr" ? 1 : 0] ?? (locale === "tr" ? "Atandı" : "Assigned");
}
