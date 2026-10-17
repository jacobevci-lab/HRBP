import { serviceStaffRoles } from "@/components/hr-service-receipts";

export type ConversationActor = { id: string; tenantId: string; role: string };
export type ConversationPage = {
  request: { id: string; tenantId: string; requestNumber: string; title: string; description: string; status: string; updatedAt: string };
  viewer: { actorId: string; tenantId: string; role: string; privateNotes: boolean };
  before: string | null;
  nextCursor: string | null;
  comments: { id: string; body: string; visibility: "REQUESTOR" | "PRIVATE_NOTE"; createdAt: string; authorName: string | null; own: boolean }[];
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const identifier = (v: unknown): v is string => text(v, 160) && /^[a-zA-Z0-9_-]+$/.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const statuses = new Set(["OPEN", "TRIAGE", "IN_PROGRESS", "WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CLOSED", "CANCELLED"]);

/** A malformed, foreign-principal, mixed-page or private-to-employee response
 * must never enter rendered state. This complements, not replaces, server ACLs.
 */
export function parseConversationPage(value: unknown, requestId: string, actor: ConversationActor, before: string | null): ConversationPage | null {
  if (!record(value) || !record(value.request) || !record(value.viewer)) return null;
  const r = value.request, v = value.viewer;
  if (r.id !== requestId || r.tenantId !== actor.tenantId || !text(r.requestNumber, 80) || !text(r.title, 200) || !text(r.description, 4000) ||
      typeof r.status !== "string" || !statuses.has(r.status) || !instant(r.updatedAt)) return null;
  if (v.actorId !== actor.id || v.tenantId !== actor.tenantId || v.role !== actor.role || v.privateNotes !== serviceStaffRoles.has(actor.role)) return null;
  if (value.before !== before || (value.nextCursor !== null && !identifier(value.nextCursor)) || !Array.isArray(value.comments) || value.comments.length > 50) return null;
  const ids = new Set<string>();
  let previous: { createdAt: string; id: string } | null = null;
  for (const row of value.comments) {
    if (!record(row) || !identifier(row.id) || ids.has(row.id) || row.id === before || !text(row.body, 4000) || !instant(row.createdAt) || typeof row.own !== "boolean" ||
        (row.authorName !== null && !text(row.authorName, 200)) ||
        (row.visibility !== "REQUESTOR" && !(v.privateNotes && row.visibility === "PRIVATE_NOTE"))) return null;
    if (previous && (row.createdAt < previous.createdAt || (row.createdAt === previous.createdAt && row.id <= previous.id))) return null;
    ids.add(row.id); previous = { createdAt: row.createdAt, id: row.id };
  }
  if (value.nextCursor !== null && (value.comments.length !== 50 || value.comments[0].id !== value.nextCursor)) return null;
  return value as ConversationPage;
}
