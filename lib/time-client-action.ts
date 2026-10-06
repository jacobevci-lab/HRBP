/** Client-side receipt verification. Server authorization and transactions remain authoritative. */
export type TimeStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "LOCKED";
export type TimeCreateInput = {
  employmentId: string;
  workDate: string;
  startAt?: string;
  endAt?: string;
  minutes: string | number;
  overtimeMinutes?: string | number;
};
export type TimeClientAction =
  | { kind: "create"; input: TimeCreateInput }
  | { kind: "transition"; entryId: string; status: TimeStatus };
export type TimeActionResult =
  | { outcome: "saved"; id: string; status: TimeStatus }
  | { outcome: "rejected"; status: number }
  | { outcome: "unknown" };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 191 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const dateMillis = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const integer = (value: unknown) => {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d{1,4}$/.test(String(value))) return NaN;
  return Number(value);
};

async function readReceipt(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Invalid receipt format");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let source = "", bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65_536) throw new Error("Receipt too large");
      source += decoder.decode(value, { stream: true });
    }
    return JSON.parse(source + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validCreate(action: Extract<TimeClientAction, { kind: "create" }>) {
  const { input } = action;
  const minutes = integer(input.minutes);
  const overtime = input.overtimeMinutes === undefined || input.overtimeMinutes === "" ? 0 : integer(input.overtimeMinutes);
  return identifier(input.employmentId) && Number.isFinite(dateMillis(input.workDate)) &&
    Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 &&
    Number.isInteger(overtime) && overtime >= 0 && overtime <= minutes &&
    (!input.startAt || Number.isFinite(dateMillis(input.startAt))) &&
    (!input.endAt || Number.isFinite(dateMillis(input.endAt))) &&
    Boolean(input.startAt) === Boolean(input.endAt);
}

function matches(action: TimeClientAction, data: Record<string, unknown>) {
  if (!identifier(data.id) || !identifier(data.employmentId) || !Number.isFinite(dateMillis(data.updatedAt))) return false;
  if (action.kind === "transition") return data.id === action.entryId && data.status === action.status;
  const input = action.input;
  const start = input.startAt ? dateMillis(input.startAt) : null;
  const end = input.endAt ? dateMillis(input.endAt) : null;
  const receivedStart = data.startAt === null ? null : dateMillis(data.startAt);
  const receivedEnd = data.endAt === null ? null : dateMillis(data.endAt);
  return data.employmentId === input.employmentId && data.status === "DRAFT" &&
    dateMillis(data.workDate) === dateMillis(input.workDate) &&
    integer(data.minutes) === integer(input.minutes) &&
    integer(data.overtimeMinutes) === (input.overtimeMinutes === undefined || input.overtimeMinutes === "" ? 0 : integer(input.overtimeMinutes)) &&
    receivedStart === start && receivedEnd === end;
}

export async function submitTimeAction(action: TimeClientAction, options: {
  fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number;
} = {}): Promise<TimeActionResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const valid = action.kind === "create"
    ? validCreate(action)
    : identifier(action.entryId) && ![".", ".."].includes(action.entryId) &&
      ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "LOCKED"].includes(action.status);
  if (!valid || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return { outcome: "rejected", status: 400 };

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (controller.signal.aborted) return { outcome: "unknown" };
    const response = await (options.fetchImpl ?? fetch)(
      action.kind === "create" ? "/api/time/entries" : `/api/time/entries/${encodeURIComponent(action.entryId)}/transition`,
      {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: controller.signal, headers: { Accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(action.kind === "create" ? action.input : { status: action.status })
      }
    );
    if (response.redirected) return { outcome: "unknown" };
    const body = await readReceipt(response);
    if (controller.signal.aborted || !object(body)) return { outcome: "unknown" };
    if ([400, 401, 403, 404, 409, 422, 429].includes(response.status) &&
        typeof body.error === "string" && body.error.trim().length > 0 && body.error.length <= 2000 && body.data === undefined) {
      return { outcome: "rejected", status: response.status };
    }
    const expected = action.kind === "create" ? 201 : 200;
    if (response.status === expected && body.error === undefined && object(body.data) && matches(action, body.data)) {
      return { outcome: "saved", id: body.data.id as string, status: body.data.status as TimeStatus };
    }
    return { outcome: "unknown" };
  } catch {
    return { outcome: "unknown" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function timeActionMessage(result: TimeActionResult, locale: "en" | "tr") {
  const tr = locale === "tr";
  if (result.outcome === "saved") return tr ? "Zaman işlemi sunucu yanıtıyla doğrulandı." : "The time action was confirmed by the server response.";
  if (result.outcome === "unknown") return tr
    ? "İşlemin sonucu doğrulanamadı; kaydedilmiş olabilir. Otomatik tekrar gönderilmedi. Yeniden işlem yapmadan önce sayfayı yenileyip güncel kayıtları kontrol edin."
    : "The outcome could not be confirmed; the action may have been saved. It was not retried automatically. Reload and check current records before another action.";
  if (result.status === 401) return tr ? "Oturum doğrulanamadı. Yeniden giriş yapıp güncel kayıtları kontrol edin." : "Your session could not be verified. Sign in again and check current records.";
  if (result.status === 403) return tr ? "Bu zaman işlemi için yetkiniz yok veya istek kaynağı reddedildi." : "You are not authorized for this time action or its request origin was rejected.";
  if (result.status === 404) return tr ? "Zaman kaydı artık kullanılamıyor. Güncel kayıtları kontrol edin." : "The time entry is no longer available. Check current records.";
  if (result.status === 409) return tr ? "Kayıt durumu, çalışma planı veya başka bir zaman kaydıyla çakışıyor. Güncel kayıtları kontrol edin." : "The action conflicts with the record state, work schedule or another time entry. Check current records.";
  if (result.status === 429) return tr ? "Çok fazla istek gönderildi. Otomatik tekrar yapılmadı." : "Too many requests. No automatic retry was made.";
  return tr ? "Zaman alanları kabul edilmedi. Girdileri kontrol edin." : "The time input was not accepted. Check the submitted fields.";
}

/** Notification cleanup is best-effort only after a verified decision. */
export async function acknowledgeTimeNotification(entryId: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!identifier(entryId) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)("/api/notifications", {
      method: "PATCH", credentials: "same-origin", redirect: "error", cache: "no-store",
      signal: controller.signal, headers: { Accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ resourceType: "TimeEntry", resourceId: entryId, read: true })
    });
    if (response.redirected) return false;
    const body = await readReceipt(response);
    return !controller.signal.aborted && response.status === 200 && object(body) && body.error === undefined &&
      object(body.data) && Number.isSafeInteger(body.data.updated) && Number(body.data.updated) >= 0 &&
      Number.isSafeInteger(body.data.unreadCount) && Number(body.data.unreadCount) >= 0;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
