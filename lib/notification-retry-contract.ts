/** Shared, dependency-free contracts. A correlation UUID is not an idempotency key. */
export const operationalStates = ["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER"] as const;
export type OperationalState = typeof operationalStates[number];
export type RetrySnapshot = { id: string; status: "FAILED" | "DEAD_LETTER"; attempts: number; updatedAt: string };
export type RetryCommand = { commandId: string; mode: "SINGLE" | "DEAD_LETTER_BATCH"; items: RetrySnapshot[] };
export type OpsItem = { id: string; eventType: string; channel: string; resourceType: string; resourceId: string;
  status: OperationalState; attempts: number; nextAttemptAt: string; lockedAt: string | null;
  lastError: string | null; createdAt: string; updatedAt: string };
export type OpsData = { viewer: { actorId: string; tenantId: string; role: string }; filter: string; limit: number;
  counts: { pending: number; processing: number; failed: number; deadLetter: number; delivered: number }; items: OpsItem[] };
export const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown, max = 191): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const utc = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function retrySnapshot(v: unknown): RetrySnapshot | null {
  if (!object(v) || !text(v.id, 128) || (typeof v.status !== "string" || !["FAILED", "DEAD_LETTER"].includes(v.status)) ||
      !integer(v.attempts) || !utc(v.updatedAt)) return null;
  return { id: v.id, status: v.status as RetrySnapshot["status"], attempts: v.attempts, updatedAt: v.updatedAt };
}
export function parseRetryCommand(v: unknown): RetryCommand | null {
  if (!object(v) || Object.keys(v).some(k => !["commandId", "mode", "items"].includes(k)) ||
      typeof v.commandId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.commandId) ||
      (typeof v.mode !== "string" || !["SINGLE", "DEAD_LETTER_BATCH"].includes(v.mode)) || !Array.isArray(v.items) || !v.items.length || v.items.length > 100) return null;
  const items = v.items.map(retrySnapshot);
  if (items.some(i => !i) || new Set(items.map(i => i!.id)).size !== items.length ||
      v.mode === "SINGLE" && items.length !== 1 || v.mode === "DEAD_LETTER_BATCH" && items.some(i => i!.status !== "DEAD_LETTER")) return null;
  return { commandId: v.commandId, mode: v.mode as RetryCommand["mode"], items: items as RetrySnapshot[] };
}
export function sameSnapshots(a: RetrySnapshot[], b: RetrySnapshot[]) {
  return a.length === b.length && a.every(x => b.some(y => x.id === y.id && x.status === y.status && x.attempts === y.attempts && x.updatedAt === y.updatedAt));
}
export function acceptsRetryReceipt(v: unknown, command: RetryCommand, user: { id: string; tenantId: string }) {
  if (!object(v) || v.actorId !== user.id || v.tenantId !== user.tenantId || v.requeued !== command.items.length || v.result !== "PENDING") return false;
  const parsed = parseRetryCommand(v.command);
  return Boolean(parsed && parsed.commandId === command.commandId && parsed.mode === command.mode && sameSnapshots(parsed.items, command.items));
}
const diagnostics = new Set(["SMTP_DELIVERY_FAILED", "SMTP_CONFIGURATION_INCOMPLETE", "EMAIL_NOTIFICATION_POLICY_BLOCKED", "NOTIFICATION_CHANNEL_UNSUPPORTED", "IN_APP_RECIPIENT_REQUIRED", "IN_APP_ROLE_UNSUPPORTED", "DELIVERY_ERROR_REDACTED"]);
export function safeOperationalError(value: string | null): string | null {
  return value ? diagnostics.has(value) ? value : "DELIVERY_ERROR_REDACTED" : null;
}
export function parseOpsData(v: unknown, user: { id: string; tenantId: string; role: string }, filter: string, limit: number): OpsData | null {
  if (!object(v) || !object(v.viewer) || v.viewer.actorId !== user.id || v.viewer.tenantId !== user.tenantId || v.viewer.role !== user.role ||
      v.filter !== filter || v.limit !== limit || !object(v.counts) ||
      !["pending", "processing", "failed", "deadLetter", "delivered"].every(k => integer((v.counts as Record<string, unknown>)[k])) ||
      !Array.isArray(v.items) || v.items.length > limit) return null;
  const ids = new Set<string>();
  for (const item of v.items) {
    if (!object(item) || !text(item.id, 128) || ids.has(item.id) || !text(item.eventType) || !text(item.channel, 40) || !text(item.resourceType) || !text(item.resourceId) ||
        !operationalStates.includes(item.status as OperationalState) || filter !== "ALL" && item.status !== filter ||
        !integer(item.attempts) || !utc(item.nextAttemptAt) || !utc(item.createdAt) || !utc(item.updatedAt) || item.lockedAt !== null && !utc(item.lockedAt) ||
        item.lastError !== null && (typeof item.lastError !== "string" || !diagnostics.has(item.lastError))) return null;
    ids.add(item.id);
  }
  return v as unknown as OpsData;
}

/** Opaque read positions are scoped hints, never authorization credentials.
 * A cursor survives deletion/movement of its anchor; every page is reauthorized. */

type Viewer = { id: string; tenantId: string; role: string };
export type OperationsPosition = { updatedAt: string; createdAt: string; id: string };
export type OperationsPage = { after: string | null; next: string | null };
export type PagedOpsData = OpsData & { page: OperationsPage };
const identifier = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128 && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);

export function operationsCursor(item: OperationsPosition, viewer: Viewer, filter: string, limit: number): string {
  return JSON.stringify([1, viewer.id, viewer.tenantId, viewer.role, filter, limit, item.updatedAt, item.createdAt, item.id]);
}

export function parseOperationsCursor(value: string, viewer: Viewer, filter: string, limit: number): OperationsPosition | null {
  if (value.length > 1024 || !["ALL", ...operationalStates].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  try {
    const data: unknown = JSON.parse(value);
    if (!Array.isArray(data) || data.length !== 9 || data[0] !== 1 || data[1] !== viewer.id || data[2] !== viewer.tenantId ||
        data[3] !== viewer.role || data[4] !== filter || data[5] !== limit || !utc(data[6]) || !utc(data[7]) || !identifier(data[8])) return null;
    const position = { updatedAt: data[6], createdAt: data[7], id: data[8] };
    return operationsCursor(position, viewer, filter, limit) === value ? position : null;
  } catch { return null; }
}

export function parsePagedOpsData(value: unknown, viewer: Viewer, filter: string, limit: number, after: string | null): PagedOpsData | null {
  const data = parseOpsData(value, viewer, filter, limit);
  if (!data || !object(value) || !object(value.page) || value.page.after !== after) return null;
  if (after !== null && !parseOperationsCursor(after, viewer, filter, limit)) return null;
  const next = value.page.next;
  if (next !== null) {
    if (typeof next !== "string" || !parseOperationsCursor(next, viewer, filter, limit) || next === after || data.items.length !== limit) return null;
    const last: OpsItem = data.items[data.items.length - 1];
    if (operationsCursor(last, viewer, filter, limit) !== next) return null;
  }
  return value as PagedOpsData;
}
