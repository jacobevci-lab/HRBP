/** Client-side receipt checking, not a replacement for API authorization or transactions. */
export type LeaveCreateInput = {
  employmentId: string;
  leaveTypeId: string;
  startsAt: string;
  endsAt: string;
  units: string;
  reason?: string;
};
export type LeaveClientAction =
  | { kind: "create"; input: LeaveCreateInput }
  | { kind: "cancel"; employmentId: string; requestId: string }
  | { kind: "decision"; requestId: string; decision: "APPROVED" | "REJECTED" };
export type LeaveActionResult =
  | { outcome: "saved"; id: string; status: "PENDING" | "APPROVED" | "CANCELLED" | "REJECTED" }
  | { outcome: "rejected"; status: number }
  | { outcome: "unknown" };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 191 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const dateMillis = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const quantity = (value: unknown) => {
  if ((typeof value !== "number" && typeof value !== "string") ||
      !/^\d{1,3}(?:\.\d{1,2})?$/.test(String(value))) return NaN;
  return Number(value);
};

/** Reads are bounded even for malformed HTML or an unexpectedly large proxy response. */
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
      if (bytes > 65536) throw new Error("Receipt too large");
      source += decoder.decode(value, { stream: true });
    }
    return JSON.parse(source + decoder.decode());
  } finally {
    // Cancelling a response read never asserts that the server transaction rolled back.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function matchesReceipt(action: LeaveClientAction, data: Record<string, unknown>) {
  if (!identifier(data.id)) return false;
  if (action.kind === "cancel") {
    return data.id === action.requestId && data.employmentId === action.employmentId && data.status === "CANCELLED";
  }
  if (action.kind === "decision") {
    return data.id === action.requestId && data.status === action.decision &&
      identifier(data.employmentId) && identifier(data.approverId) &&
      Number.isFinite(dateMillis(data.decidedAt));
  }
  const input = action.input;
  return data.employmentId === input.employmentId && data.leaveTypeId === input.leaveTypeId &&
    typeof data.status === "string" && ["PENDING", "APPROVED"].includes(data.status) &&
    Number.isFinite(dateMillis(data.startsAt)) && dateMillis(data.startsAt) === dateMillis(input.startsAt) &&
    Number.isFinite(dateMillis(data.endsAt)) && dateMillis(data.endsAt) === dateMillis(input.endsAt) &&
    Number.isFinite(quantity(data.units)) && quantity(data.units) === quantity(input.units);
}

export async function submitLeaveAction(action: LeaveClientAction, options: {
  fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number;
} = {}): Promise<LeaveActionResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const validTarget = action.kind === "decision"
    ? identifier(action.requestId) && ![".", ".."].includes(action.requestId) &&
      ["APPROVED", "REJECTED"].includes(action.decision)
    : identifier(action.kind === "create" ? action.input.employmentId : action.employmentId) &&
      identifier(action.kind === "create" ? action.input.leaveTypeId : action.requestId);
  if (!validTarget ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    return { outcome: "rejected", status: 400 };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    if (controller.signal.aborted) return { outcome: "unknown" };
    const response = await (options.fetchImpl ?? fetch)(action.kind === "create"
      ? "/api/leave/requests" : `/api/leave/requests/${encodeURIComponent(action.requestId)}/${action.kind === "decision" ? "decision" : "self-cancel"}`, {
      method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json", ...(action.kind !== "cancel" ? { "content-type": "application/json" } : {}) },
      ...(action.kind === "create" ? { body: JSON.stringify(action.input) }
        : action.kind === "decision" ? { body: JSON.stringify({ decision: action.decision }) } : {})
    });
    if (response.redirected) return { outcome: "unknown" };
    const body = await readReceipt(response);
    if (controller.signal.aborted || !object(body)) return { outcome: "unknown" };
    if ([400, 401, 403, 404, 409, 422, 429].includes(response.status) &&
        typeof body.error === "string" && body.error.trim().length > 0 && body.error.length <= 2000 && body.data === undefined) {
      // Only the status is passed to the UI; arbitrary upstream error text is not displayed.
      return { outcome: "rejected", status: response.status };
    }
    if (response.status === (action.kind === "create" ? 201 : 200) &&
        body.error === undefined && object(body.data) && matchesReceipt(action, body.data)) {
      return { outcome: "saved", id: body.data.id as string, status: body.data.status as "PENDING" | "APPROVED" | "CANCELLED" | "REJECTED" };
    }
    return { outcome: "unknown" };
  } catch {
    // No POST retry: a missing/invalid receipt does not imply an uncommitted transaction.
    return { outcome: "unknown" };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function leaveActionMessage(result: LeaveActionResult, locale: "en" | "tr") {
  const tr = locale === "tr";
  if (result.outcome === "saved") return tr ? "İzin işlemi sunucu yanıtıyla doğrulandı." : "The leave action was confirmed by the server response.";
  if (result.outcome === "unknown") return tr
    ? "İşlemin sonucu doğrulanamadı; kaydedilmiş olabilir. Otomatik tekrar gönderilmedi. Yeniden işlem yapmadan önce sayfayı yenileyip taleplerinizi kontrol edin. Yenileme kaydedilmemiş form bilgilerini siler."
    : "The outcome could not be confirmed; the action may have been saved. It was not retried automatically. Reload and check your requests before another action. Reloading discards unsaved form input.";
  if (result.status === 401) return tr ? "Oturum doğrulanamadı. Formunuz korunuyor; devam etmek için yeniden giriş yapın." : "Your session could not be verified. The form is retained; sign in again to continue.";
  if (result.status === 403) return tr ? "Bu işlem için yetkiniz yok veya istek kaynağı kabul edilmedi." : "You are not authorized for this action or the request origin was rejected.";
  if (result.status === 409) return tr ? "Talep, mevcut izinlerle, bakiye veya kayıt durumuyla çakışıyor. Formunuz korunuyor; güncel taleplerinizi kontrol edin." : "The action conflicts with existing leave, the balance or the record state. Your form is retained; check your current requests.";
  if (result.status === 404) return tr ? "İlgili kayıt artık kullanılamıyor. Güncel kayıtları kontrol edin." : "The related record is no longer available. Check the current records.";
  if (result.status === 429) return tr ? "Çok fazla istek gönderildi. Otomatik tekrar yapılmadı; daha sonra yeniden deneyin." : "Too many requests. No automatic retry was made; try again later.";
  return tr ? "Alanları kontrol edin: izin türü, tarihler, miktar veya açıklama kabul edilmedi. Formunuz korunuyor." : "Check the leave type, dates, quantity and reason. The input was not accepted; your form is retained.";
}

/** Badge cleanup is best-effort AFTER a verified decision, never its completion signal. */
export async function acknowledgeLeaveNotification(requestId: string, options: {
  fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!identifier(requestId) || requestId.length > 160 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)("/api/notifications", {
      method: "PATCH", credentials: "same-origin", redirect: "error", cache: "no-store",
      signal: controller.signal, headers: { Accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ resourceType: "LeaveRequest", resourceId: requestId, read: true })
    });
    if (response.redirected) return false;
    const body = await readReceipt(response);
    return !controller.signal.aborted && response.status === 200 && object(body) && body.error === undefined &&
      object(body.data) && Number.isSafeInteger(body.data.updated) && Number(body.data.updated) >= 0 &&
      Number.isSafeInteger(body.data.unreadCount) && Number(body.data.unreadCount) >= 0;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
