/** Receipt validation only. Authorization, schedules and transactions remain server-owned. */
export type TimeTarget = "SUBMITTED" | "APPROVED" | "REJECTED" | "LOCKED";
export type TimeActionResult =
  | { outcome: "saved"; id: string; status: TimeTarget }
  | { outcome: "rejected"; status: number }
  | { outcome: "unknown" };
export type TimeTransportOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 160 && value === value.trim() &&
  !/[\u0000-\u001f\u007f]/.test(value) && ![".", ".."].includes(value);
const date = (value: unknown) => typeof value === "string" && value.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
export function isTimeTarget(value: unknown): value is TimeTarget {
  return typeof value === "string" && ["SUBMITTED", "APPROVED", "REJECTED", "LOCKED"].includes(value);
}

async function readReceipt(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Invalid receipt");
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let source = "", bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new Error("Aborted receipt");
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error("Aborted receipt");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error("Receipt too large");
      source += decoder.decode(value, { stream: true });
    }
    return JSON.parse(source + decoder.decode());
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** One write only. The deadline also bounds a stalled body; abort never implies rollback. */
async function request(url: string, method: "POST" | "PATCH", payload: object, options: TimeTransportOptions, maxMs: number) {
  const timeoutMs = options.timeoutMs ?? maxMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxMs) throw new Error("Invalid timeout");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let stop: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new Error("Request interrupted"));
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  const timer = setTimeout(abort, timeoutMs);
  const operation = async () => {
    if (controller.signal.aborted) throw new Error("Request aborted");
    const response = await (options.fetchImpl ?? fetch)(url, {
      method, credentials: "same-origin", redirect: "error", cache: "no-store",
      signal: controller.signal, headers: { Accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    // A late response from a transport that ignored abort cannot become a receipt.
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("Request aborted"); }
    const body = await readReceipt(response, controller.signal);
    if (controller.signal.aborted) throw new Error("Request aborted");
    return { status: response.status, body };
  };
  try { return await Promise.race([operation(), interrupted]); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", stop);
  }
}

export async function submitTimeTransition(entryId: string, target: TimeTarget, options: TimeTransportOptions = {}): Promise<TimeActionResult> {
  if (!identifier(entryId) || !isTimeTarget(target)) return { outcome: "rejected", status: 400 };
  try {
    const { status, body } = await request(`/api/time/entries/${encodeURIComponent(entryId)}/transition`, "POST", { status: target }, options, 20_000);
    if (!object(body)) return { outcome: "unknown" };
    if ([400, 401, 403, 404, 409, 422, 429].includes(status) && body.data === undefined &&
        typeof body.error === "string" && body.error.trim().length > 0 && body.error.length <= 2000) {
      return { outcome: "rejected", status }; // Never display upstream error text or record details.
    }
    const data = body.data;
    if (status !== 200 || body.error !== undefined || !object(data) || data.id !== entryId || data.status !== target ||
        !identifier(data.employmentId) || !date(data.updatedAt) || !date(data.workDate) ||
        !Number.isInteger(data.minutes) || !Number.isInteger(data.overtimeMinutes) ||
        (target !== "REJECTED" && (Number(data.minutes) < 1 || Number(data.minutes) > 1440 ||
          Number(data.overtimeMinutes) < 0 || Number(data.overtimeMinutes) > Number(data.minutes)))) {
      return { outcome: "unknown" };
    }
    // Rejection is permitted for legacy invalid time quantities; do not re-apply approval rules.
    const decisionMatches = target === "SUBMITTED"
      ? data.approvedById === null && data.approvedAt === null
      : identifier(data.approvedById) && date(data.approvedAt);
    return decisionMatches ? { outcome: "saved", id: entryId, status: target } : { outcome: "unknown" };
  } catch { return { outcome: "unknown" }; }
}

/** Notification cleanup is separately bounded and is never the decision's success signal. */
export async function acknowledgeTimeNotification(entryId: string, options: TimeTransportOptions = {}): Promise<boolean> {
  if (!identifier(entryId)) return false;
  try {
    const { status, body } = await request("/api/notifications", "PATCH", { resourceType: "TimeEntry", resourceId: entryId, read: true }, options, 5_000);
    return status === 200 && object(body) && body.error === undefined && object(body.data) &&
      Number.isSafeInteger(body.data.updated) && Number(body.data.updated) >= 0 &&
      Number.isSafeInteger(body.data.unreadCount) && Number(body.data.unreadCount) >= 0;
  } catch { return false; }
}

export function timeActionMessage(result: TimeActionResult, locale: "en" | "tr") {
  const tr = locale === "tr";
  if (result.outcome === "saved") return tr ? "Zaman işlemi sunucu yanıtıyla doğrulandı." : "The time transition was confirmed by the server response.";
  if (result.outcome === "unknown") return tr
    ? "Sonuç doğrulanamadı; işlem kaydedilmiş olabilir. Otomatik tekrar gönderilmedi. Yeni işlemden önce sayfayı yenileyip güncel kaydı kontrol edin."
    : "The outcome could not be confirmed; it may have been saved. No automatic retry was made. Reload and review the current record before another action.";
  if (result.status === 401) return tr ? "Oturum doğrulanamadı. Yenileyip yeniden giriş yapın." : "Your session could not be verified. Reload and sign in again.";
  if (result.status === 403) return tr ? "İşlem için yetkiniz yok veya onay/kilitleme görev ayrılığı sağlanmıyor. Güncel kaydı kontrol edin." : "This action is not authorized or approval/locking separation is not satisfied. Review the current record.";
  if (result.status === 409) return tr ? "Kayıt durumu, çalışma planı veya zaman bütünlüğü bu işlemle çakışıyor. Yeni işlemden önce yenileyin." : "The record state, effective schedule or time integrity conflicts with this action. Reload before another action.";
  if (result.status === 404) return tr ? "Kayıt artık kullanılamıyor. Yenileyip erişiminizi kontrol edin." : "This record is no longer available. Reload and check your access.";
  return tr ? "İşlem kabul edilmedi. Yeni işlemden önce yenileyip güncel kaydı kontrol edin." : "The action was not accepted. Reload and review the current record before another action.";
}
