/** Client receipt checks; existing time APIs remain authoritative for access and state. */
export type TimeDraft = { employmentId: string; workDate: string; minutes: number; overtimeMinutes: number; startAt?: string; endAt?: string };
export type TimeClientAction =
  | { kind: "create"; draft: TimeDraft }
  | { kind: "submit"; entryId: string; priorStatus: "DRAFT" | "REJECTED"; draft: TimeDraft };
export type TimeClientResult =
  | { outcome: "saved"; id: string; status: "DRAFT" | "SUBMITTED" }
  | { outcome: "invalid" }
  | { outcome: "rejected"; status: number }
  | { outcome: "unknown" };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim() === value && !/[\u0000-\u001f\u007f/\\]/.test(value) && value !== "." && value !== "..";
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function instant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.toISOString() === value;
}
function whole(value: unknown): number | null {
  if (typeof value === "string" && /^\d{1,4}$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
/** Explicit normalization only: no coercion of booleans, arrays or invalid dates. */
export function parseTimeDraft(value: unknown): TimeDraft | null {
  if (!object(value) || !identifier(value.employmentId) || !day(value.workDate)) return null;
  const minutes = whole(value.minutes);
  const overtimeMinutes = whole(value.overtimeMinutes === undefined || value.overtimeMinutes === "" ? 0 : value.overtimeMinutes);
  if (minutes === null || minutes < 1 || minutes > 1440 || overtimeMinutes === null || overtimeMinutes < 0 || overtimeMinutes > minutes) return null;
  const startAt = value.startAt === undefined || value.startAt === null || value.startAt === "" ? undefined : value.startAt;
  const endAt = value.endAt === undefined || value.endAt === null || value.endAt === "" ? undefined : value.endAt;
  if ((startAt === undefined) !== (endAt === undefined)) return null;
  if (startAt !== undefined && endAt !== undefined) {
    if (!instant(startAt) || !instant(endAt)) return null;
    const elapsed = (Date.parse(endAt) - Date.parse(startAt)) / 60000;
    if (elapsed <= 0 || Math.ceil(elapsed) > 1440 || minutes > Math.ceil(elapsed)) return null;
  }
  return { employmentId: value.employmentId, workDate: value.workDate, minutes, overtimeMinutes,
    ...(typeof startAt === "string" ? { startAt } : {}), ...(typeof endAt === "string" ? { endAt } : {}) };
}
function localMinute(value: unknown): string | undefined | null {
  if (value === "" || value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !day(value.slice(0, 10))) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
  const expected = [value.slice(0, 4), value.slice(5, 7), value.slice(8, 10), value.slice(11, 13), value.slice(14, 16)].map(Number);
  // Reject browser-normalized local times, including nonexistent DST times.
  return parts.every((part, i) => part === expected[i]) ? d.toISOString() : null;
}
export function timeDraftFromForm(value: unknown): TimeDraft | null {
  if (!object(value)) return null;
  const startAt = localMinute(value.startAt), endAt = localMinute(value.endAt);
  if (startAt === null || endAt === null) return null;
  return parseTimeDraft({ ...value, startAt, endAt });
}
function actionInput(value: unknown): TimeClientAction | null {
  if (!object(value)) return null;
  const draft = parseTimeDraft(value.draft);
  if (!draft) return null;
  if (value.kind === "create") return { kind: "create", draft };
  if (value.kind === "submit" && identifier(value.entryId) && (value.priorStatus === "DRAFT" || value.priorStatus === "REJECTED")) return { kind: "submit", entryId: value.entryId, priorStatus: value.priorStatus, draft };
  return null;
}
function receipt(body: unknown, action: TimeClientAction): TimeClientResult | null {
  if (!object(body) || Object.hasOwn(body, "error") || !object(body.data)) return null;
  const r = body.data, d = action.draft;
  const status = action.kind === "create" ? "DRAFT" : "SUBMITTED";
  if (!identifier(r.id) || r.employmentId !== d.employmentId || r.status !== status || r.workDate !== d.workDate + "T00:00:00.000Z" || r.minutes !== d.minutes || r.overtimeMinutes !== d.overtimeMinutes || r.startAt !== (d.startAt ?? null) || r.endAt !== (d.endAt ?? null)) return null;
  if (action.kind === "create" && r.source !== "SELF_SERVICE") return null;
  if (action.kind === "submit" && (r.id !== action.entryId || r.approvedById !== null || r.approvedAt !== null)) return null;
  return { outcome: "saved", id: r.id, status };
}
/** One bounded same-origin POST; no retry even when the server may have committed. */
export async function submitTimeAction(input: TimeClientAction, options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<TimeClientResult> {
  const action = actionInput(input), timeoutMs = options.timeoutMs ?? 15000;
  if (!action || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return { outcome: "invalid" };
  if (options.signal?.aborted) return { outcome: "unknown" };
  const controller = new AbortController(), stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true });
    timer = setTimeout(stop, timeoutMs);
  });
  try {
    const work = (async (): Promise<TimeClientResult> => {
      const endpoint = action.kind === "create" ? "/api/time/entries" : `/api/time/entries/${encodeURIComponent(action.entryId)}/transition`;
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(action.kind === "create" ? action.draft : { status: "SUBMITTED" })
      });
      if (controller.signal.aborted || response.redirected || !response.body || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); return { outcome: "unknown" };
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0, text = "";
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) return { outcome: "unknown" };
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 65536) return { outcome: "unknown" };
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      const body: unknown = JSON.parse(text);
      if (response.status === (action.kind === "create" ? 201 : 200)) return receipt(body, action) ?? { outcome: "unknown" };
      if ([400, 401, 403, 404, 409, 413, 422, 429].includes(response.status) && object(body) && typeof body.error === "string" && body.error.trim().length > 0 && !Object.hasOwn(body, "data")) return { outcome: "rejected", status: response.status };
      return { outcome: "unknown" };
    })();
    return await Promise.race([work, stopped]);
  } catch { return { outcome: "unknown" }; }
  finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", stop);
    if (reader) void reader.cancel().catch(() => {});
  }
}
