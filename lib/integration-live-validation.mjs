export const INTEGRATION_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function integrationValidationCurrent(value, nowMs = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - timestamp;
  return age >= -60_000 && age <= INTEGRATION_VALIDATION_MAX_AGE_MS;
}

function boundedTimeout(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5000;
  return Math.min(10000, Math.max(1000, Math.floor(numeric)));
}

function normalizedLiteralHostname(hostname) {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function unsafeLiteralHost(hostname) {
  const host = normalizedLiteralHostname(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (host.includes(":")) {
    const compact = host.replace(/^0+/, "");
    if (host === "::" || host === "::1") return true;
    if (/^fe[89ab]/i.test(compact)) return true;
    if (/^ff/i.test(compact)) return true;
    if (/^::ffff:127\./i.test(host) || /^::ffff:169\.254\./i.test(host)) return true;
  }

  return false;
}

function parsedHttpUrl(value, allowHttp) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return null;
  if (unsafeLiteralHost(url.hostname)) return null;
  return url;
}

export function parseIntegrationProbeOrigins(value, allowHttp = false) {
  if (!value) return [];
  if (typeof value !== "string" || value.length > 16384) return null;
  const raw = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (raw.length > 100) return null;
  const origins = [];
  const seen = new Set();
  for (const item of raw) {
    const url = parsedHttpUrl(item, allowHttp);
    if (!url || url.pathname !== "/" || url.search || url.hash) return null;
    if (seen.has(url.origin)) return null;
    seen.add(url.origin);
    origins.push(url.origin);
  }
  return origins;
}

export function integrationProbeTarget(baseUrl, allowedOrigins, allowHttp = false) {
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) return null;
  const url = parsedHttpUrl(baseUrl, allowHttp);
  if (!url || !allowedOrigins.includes(url.origin)) return null;
  return url;
}

export async function probeIntegrationEndpoint({
  baseUrl,
  allowedOrigins,
  allowHttp = false,
  timeoutMs = 5000,
  fetchImpl = fetch
}) {
  const target = integrationProbeTarget(baseUrl, allowedOrigins, allowHttp);
  if (!target) return { ok: false, reason: "TARGET_NOT_ALLOWED" };

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(target.toString(), {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(boundedTimeout(timeoutMs)),
      headers: { accept: "*/*" }
    });
    try { await response.body?.cancel(); } catch {}
    return {
      ok: true,
      status: response.status,
      durationMs: Math.max(0, Date.now() - startedAt),
      origin: target.origin
    };
  } catch {
    return {
      ok: false,
      reason: "TRANSPORT_UNAVAILABLE",
      durationMs: Math.max(0, Date.now() - startedAt),
      origin: target.origin
    };
  }
}
