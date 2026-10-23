import { asServiceRevision } from "@/lib/hr-service-revision";
import { isObject } from "@/components/hr-service-action-state";
import { acceptsServiceTransition, type ServicePrincipal } from "@/components/hr-service-receipts";
export type RoutingOptions = {
  request: { id: string; tenantId: string; requestNumber: string; title: string; status: string; updatedAt: string; queue: string | null; assigneeId: string | null };
  viewer: { actorId: string; tenantId: string; role: string };
  initial: boolean; queue: string | null; queueAvailable: boolean;
  queues: Array<{ key: string; name: string }>;
  assignees: Array<{ id: string; displayName: string }>;
  queuesTruncated: boolean; assigneesTruncated: boolean;
};
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 191 && !/[\u0000-\u0020\u007f]/.test(v);
const queue = (v: unknown) => v === null || typeof v === "string" && /^[A-Z0-9_-]{2,40}$/.test(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
export function parseRoutingOptions(value: unknown, user: ServicePrincipal, requestId: string, revision: string, selected: string | null | undefined): RoutingOptions | null {
  if (!isObject(value) || !isObject(value.request) || !isObject(value.viewer)) return null;
  const r = value.request, v = value.viewer;
  if (r.id !== requestId || r.tenantId !== user.tenantId || r.updatedAt !== revision || !asServiceRevision(revision) ||
    v.actorId !== user.id || v.tenantId !== user.tenantId || v.role !== user.role ||
    !["OPEN", "TRIAGE", "IN_PROGRESS", "WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED"].includes(r.status as string) ||
    !text(r.title, 200) || !text(r.requestNumber, 100) || !queue(r.queue) || !(r.assigneeId === null || id(r.assigneeId)) ||
    value.initial !== (selected === undefined) || value.queue !== (selected === undefined ? r.queue : selected) || !queue(value.queue) ||
    typeof value.queueAvailable !== "boolean" || typeof value.queuesTruncated !== "boolean" || typeof value.assigneesTruncated !== "boolean" ||
    !Array.isArray(value.queues) || value.queues.length > 100 || !Array.isArray(value.assignees) || value.assignees.length > 200) return null;
  if (value.queue === null && !value.queueAvailable || !value.queueAvailable && value.assignees.length) return null;
  if (!value.queues.every(q => isObject(q) && q.key !== null && queue(q.key) && text(q.name, 200)) ||
      !value.assignees.every(a => isObject(a) && id(a.id) && text(a.displayName, 200)) ||
      new Set(value.queues.map(q => q.key)).size !== value.queues.length || new Set(value.assignees.map(a => a.id)).size !== value.assignees.length) return null;
  return value as RoutingOptions;
}
export function acceptsRoutingWrite(value: unknown, user: ServicePrincipal, requestId: string, status: string, revision: string, selectedQueue: string | null, assigneeId: string | null) {
  return acceptsServiceTransition(value, user, requestId, status, revision) && isObject(value) && isObject(value.writeReceipt) &&
    value.queue === selectedQueue && value.assigneeId === assigneeId && value.writeReceipt.queue === selectedQueue && value.writeReceipt.assigneeId === assigneeId;
}
