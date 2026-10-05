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
  | { kind: "cancel"; employmentId: string; requestId: string };
export type LeaveActionResult =
  | { outcome: "saved"; id: string; status: "PENDING" | "APPROVED" | "CANCELLED" }
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
  const employmentId = action.kind === "create" ? action.input.employmentId : action.employmentId;
  if (!identifier(employmentId) ||
      (action.kind === "create" ? !identifier(action.input.leaveTypeId) : !identifier(action.requestId)) ||
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
      ? "/api/leave/requests" : `/api/leave/requests/${encodeURIComponent(action.requestId)}/self-cancel`, {
      method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json", ...(action.kind === "create" ? { "content-type": "application/json" } : {}) },
      ...(action.kind === "create" ? { body: JSON.stringify(action.input) } : {})
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
      return { outcome: "saved", id: body.data.id as string, status: body.data.status as "PENDING" | "APPROVED" | "CANCELLED" };
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
