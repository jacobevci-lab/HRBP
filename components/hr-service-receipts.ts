import { isObject } from "@/components/hr-service-action-state";
export type ServicePrincipal = { id: string; tenantId: string; role: string; employmentId?: string | null };
export type Intake = { category: string; subcategory: string; title: string; description: string; priority: string };
const identifier = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 191 && !/[\u0000-\u0020\u007f]/.test(value);
const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const serviceWriterRoles = new Set(["EMPLOYEE", "MANAGER", "HRBP", "HR_OPERATIONS", "TENANT_ADMIN"]);
export const serviceStaffRoles = new Set(["HRBP", "HR_OPERATIONS", "TENANT_ADMIN"]);
export function validIntake(value: Intake) {
  return value.category.length >= 1 && value.category.length <= 80 && value.subcategory.length <= 80 &&
    value.title.length >= 1 && value.title.length <= 200 && value.description.length >= 1 && value.description.length <= 4000 &&
    ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value.priority);
}
export function acceptsServiceIntake(data: unknown, user: ServicePrincipal, sent: Intake) {
  if (!isObject(data)) return false;
  const self = user.role === "EMPLOYEE" || user.role === "MANAGER";
  return identifier(data.id) && typeof data.requestNumber === "string" && /^HR-[0-9]{4}-[A-F0-9]{8}$/.test(data.requestNumber) &&
    data.tenantId === user.tenantId && data.requestorId === user.id && data.status === "OPEN" &&
    data.subjectEmploymentId === (self ? user.employmentId : null) &&
    data.category === sent.category && data.subcategory === (sent.subcategory || null) &&
    data.title === sent.title && data.description === sent.description && data.priority === sent.priority && iso(data.createdAt);
}
export function acceptsServiceTransition(data: unknown, user: ServicePrincipal, id: string, target: string) {
  return isObject(data) && data.id === id && data.tenantId === user.tenantId && data.status === target && iso(data.updatedAt);
}
export function acceptsServiceComment(data: unknown, user: ServicePrincipal, id: string, body: string, visibility: string) {
  return isObject(data) && identifier(data.id) && data.tenantId === user.tenantId && data.requestId === id &&
    data.authorId === user.id && data.body === body && data.visibility === visibility && iso(data.createdAt);
}
