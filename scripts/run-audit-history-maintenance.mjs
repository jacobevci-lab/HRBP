const MAX_RESPONSE_BYTES = 16 * 1024;

export function validateAuditHistorySchedulerConfiguration({
  url, token, localSmoke = false, privateHttpHost = null
}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error("Invalid audit history endpoint configuration."); }
  const loopback = localSmoke && endpoint.protocol === "http:" &&
    ["127.0.0.1", "[::1]"].includes(endpoint.hostname);
  const privateHttp = typeof privateHttpHost === "string" &&
    /^[a-z0-9][a-z0-9.-]{0,62}$/.test(privateHttpHost) &&
    endpoint.protocol === "http:" && endpoint.hostname === privateHttpHost && endpoint.port === "3000";
  if ((!loopback && !privateHttp && endpoint.protocol !== "https:") ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== "/api/internal/audit-history") {
    throw new Error("Audit history scheduler requires HTTPS, explicit loopback smoke mode, or the pinned private service host.");
  }
  if (typeof token !== "string" || token.length < 24 || token.length > 4096 || /\s/.test(token)) {
    throw new Error("A valid internal maintenance token is required.");
  }
  return endpoint;
}

async function readBounded(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("AUDIT_HISTORY_RESPONSE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function request(fetchImpl, endpoint, token, method, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method, redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }
    });
    return { status: response.status, ok: response.ok, body: await readBounded(response) };
  } finally {
    clearTimeout(timeout);
  }
}

function preflight(body) {
  const data = body?.data;
  return data?.scanVersion === 1 && data?.scheduleVersion === 1 &&
    data?.mode === "BOUNDED_RESUMABLE_FULL_HISTORY" &&
    data?.cadence === "SEPARATE_FROM_FAST_AUDIT_INTEGRITY";
}
function boundedOutcome(body) {
  const data = body?.data;
  if (!data || data.scanVersion !== 1 || data.scheduleVersion !== 1 ||
      data.selectionMode !== "DURABLE_KEYSET" ||
      !["NO_TENANTS", "FRESH", "PARTIAL", "VERIFIED"].includes(data.outcome) ||
      !Number.isSafeInteger(data.tenantUniverse) || data.tenantUniverse < 0 ||
      !Number.isSafeInteger(data.eventsChecked) || data.eventsChecked < 0 ||
      typeof data.cycleCompleted !== "boolean") return null;
  return {
    outcome: data.outcome,
    eventsChecked: data.eventsChecked,
    cycleCompleted: data.cycleCompleted
  };
}

/** One bounded POST only. Unknown network outcomes are never immediately replayed:
 * the next scheduled invocation resumes from the database-fenced progress state.
 */
export async function runAuditHistoryMaintenance({
  url, token, localSmoke = false, privateHttpHost = null,
  fetchImpl = globalThis.fetch, timeoutMs = 90_000
}) {
  const endpoint = validateAuditHistorySchedulerConfiguration({ url, token, localSmoke, privateHttpHost });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) {
    throw new Error("Invalid audit history request timeout.");
  }

  let capability;
  try { capability = await request(fetchImpl, endpoint, token, "GET", timeoutMs); }
  catch {
    return { success: false, ambiguous: false, code: "AUDIT_HISTORY_PREFLIGHT_UNAVAILABLE" };
  }
  if (!capability.ok || !preflight(capability.body)) {
    return { success: false, ambiguous: false, httpStatus: capability.status,
      code: "AUDIT_HISTORY_PROTOCOL_UNAVAILABLE_DEPLOY_REQUIRED" };
  }

  const startedAt = Date.now();
  let response;
  try { response = await request(fetchImpl, endpoint, token, "POST", timeoutMs); }
  catch {
    return { success: false, ambiguous: true, durationMs: Date.now() - startedAt,
      code: "AUDIT_HISTORY_OUTCOME_UNKNOWN_RESUME_FROM_DB_STATE" };
  }

  const outcome = response.ok ? boundedOutcome(response.body) : null;
  if (outcome) {
    return { success: true, ambiguous: false, httpStatus: response.status,
      durationMs: Date.now() - startedAt, ...outcome };
  }

  const code = typeof response.body?.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(response.body.code) ? response.body.code : null;
  return {
    success: false, ambiguous: false, httpStatus: response.status,
    durationMs: Date.now() - startedAt,
    code: response.status === 409 && code === "AUDIT_SCHEDULE_BUSY"
      ? "AUDIT_HISTORY_SCHEDULE_BUSY"
      : response.status === 500 && code === "AUDIT_HISTORY_INTEGRITY_FAILURE"
        ? "AUDIT_HISTORY_INTEGRITY_FAILURE"
        : "AUDIT_HISTORY_UNEXPECTED_RESPONSE"
  };
}
