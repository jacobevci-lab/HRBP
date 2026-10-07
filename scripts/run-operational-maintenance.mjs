import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { MAINTENANCE_JOBS, MAINTENANCE_PROTOCOL_VERSION } from "../lib/maintenance-protocol.mjs";

const MAX_RESPONSE_BYTES = 64 * 1024;

export function validateConfiguration({ url, token, job = "all", localSmoke = false, privateHttpHost = null }) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error("Invalid maintenance endpoint configuration."); }
  const loopback = localSmoke && endpoint.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(endpoint.hostname);
  const privateHttp = typeof privateHttpHost === "string" && /^[a-z0-9][a-z0-9.-]{0,62}$/.test(privateHttpHost) &&
    endpoint.protocol === "http:" && endpoint.hostname === privateHttpHost && endpoint.port === "3000";
  if ((!loopback && !privateHttp && endpoint.protocol !== "https:") || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== "/api/internal/maintenance") {
    throw new Error("Maintenance requires HTTPS, explicit loopback smoke mode, or the pinned private service host.");
  }
  if (typeof token !== "string" || token.length < 24 || token.length > 4096 || /\s/.test(token)) {
    throw new Error("A valid internal maintenance token is required.");
  }
  if (job !== "all" && !MAINTENANCE_JOBS.includes(job)) throw new Error("Unsupported maintenance job selection.");
  return { endpoint, selected: job === "all" ? [...MAINTENANCE_JOBS] : [job] };
}

async function readBounded(response) {
  if (!response.body) return { body: null, resourceLimit: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("RESPONSE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body = null;
  try { body = JSON.parse(text); } catch { /* Never print an upstream HTML/error body. */ }
  return { body, resourceLimit: /error code:\s*1102\b/i.test(text) };
}

async function request(fetchImpl, endpoint, token, method, job, timeoutMs) {
  const target = new URL(endpoint);
  if (job) target.searchParams.set("job", job);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target, {
      method, redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const parsed = await readBounded(response);
    return { status: response.status, ok: response.ok, ...parsed };
  } finally { clearTimeout(timeout); }
}

function matchesContract(body) {
  const data = body?.data;
  return data?.protocolVersion === MAINTENANCE_PROTOCOL_VERSION &&
    Array.isArray(data.jobs) && data.jobs.length === MAINTENANCE_JOBS.length &&
    data.jobs.every((job, index) => job === MAINTENANCE_JOBS[index]);
}

function matchesExecution(body, job) {
  const execution = body?.execution;
  const entry = execution?.jobs?.[0];
  return execution?.protocolVersion === MAINTENANCE_PROTOCOL_VERSION && execution.mode === "single" &&
    Array.isArray(execution.jobs) && execution.jobs.length === 1 && entry?.job === job &&
    ["success", "failed"].includes(entry.status) &&
    Number.isFinite(entry.durationMs) && entry.durationMs >= 0;
}

/** A preflight prevents old deployments from silently running ALL jobs once per selected job. */
export async function runMaintenance({ url, token, job = "all", localSmoke = false, privateHttpHost = null,
  fetchImpl = globalThis.fetch, timeoutMs = 90_000, log = () => {} }) {
  const { endpoint, selected } = validateConfiguration({ url, token, job, localSmoke, privateHttpHost });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) throw new Error("Invalid request timeout.");
  const report = { success: false, stopped: false, requested: selected.length, results: [] };
  let preflight;
  try {
    preflight = await request(fetchImpl, endpoint, token, "GET", null, timeoutMs);
  } catch {
    report.stopped = true;
    report.results.push({ job: "preflight", status: "failed", code: "PREFLIGHT_UNAVAILABLE" });
    log(report.results.at(-1));
    return report;
  }
  if (!preflight.ok || !matchesContract(preflight.body)) {
    report.stopped = true;
    report.results.push({ job: "preflight", status: "failed", httpStatus: preflight.status,
      code: "PROTOCOL_UNAVAILABLE_DEPLOY_REQUIRED" });
    log(report.results.at(-1));
    return report;
  }

  for (const selectedJob of selected) {
    const startedAt = Date.now();
    let response;
    try {
      // Deliberately no POST retries: a timeout does not prove that the transaction rolled back.
      response = await request(fetchImpl, endpoint, token, "POST", selectedJob, timeoutMs);
    } catch {
      report.stopped = true;
      report.results.push({ job: selectedJob, status: "failed", durationMs: Date.now() - startedAt,
        code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY" });
      log(report.results.at(-1));
      break;
    }
    const matched = matchesExecution(response.body, selectedJob);
    const failures = response.body?.failures;
    const success = response.ok && matched && response.body.execution.jobs[0].status === "success" &&
      response.body.data !== null && typeof response.body.data === "object" && !Array.isArray(response.body.data) &&
      (failures === undefined || (Array.isArray(failures) && failures.length === 0));
    const knownJobFailure = response.status === 500 && matched &&
      response.body.execution.jobs[0].status === "failed" && Array.isArray(failures) &&
      failures.length === 1 && failures[0]?.job === selectedJob;
    const resourceLimit = response.status === 503 && response.resourceLimit;
    const result = { job: selectedJob, status: success ? "success" : "failed", httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      ...(success ? {} : { code: resourceLimit ? "WORKER_RESOURCE_LIMIT_1102" :
        knownJobFailure ? "JOB_FAILED" : "UNEXPECTED_RESPONSE_STOPPED" }) };
    report.results.push(result);
    log(result);
    // A confirmed domain failure or terminated 1102 invocation must not suppress later jobs.
    // Auth failures, incompatible deployments and ambiguous outcomes instead stop the run.
    if (!success && !knownJobFailure && !resourceLimit) { report.stopped = true; break; }
  }
  report.success = report.results.length === selected.length && report.results.every((result) => result.status === "success");
  return report;
}

export function markdownSummary(report) {
  return ["## HRBP operational maintenance", "",
    `Result: **${report.success ? "success" : "failed"}**${report.stopped ? " (stopped safely)" : ""}.`, "",
    "| Job | Status | HTTP | Wall time (ms) | Diagnostic |", "| --- | --- | --- | --- | --- |",
    ...report.results.map((result) => `| ${result.job} | ${result.status} | ${result.httpStatus ?? "—"} | ${result.durationMs ?? "—"} | ${result.code ?? "—"} |`), "",
    "No automatic POST retries. Inspect unknown outcomes before manually rerunning a selected job.", ""].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runMaintenance({
      url: process.env.HRBP_MAINTENANCE_URL,
      token: process.env.HRBP_MAINTENANCE_TOKEN,
      job: process.env.HRBP_MAINTENANCE_JOB || "all",
      localSmoke: process.env.HRBP_MAINTENANCE_LOCAL_SMOKE === "true",
      log: (result) => console.log(JSON.stringify(result))
    });
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdownSummary(report));
    if (!report.success) process.exitCode = 1;
  } catch {
    console.error("Maintenance runner failed. Check configuration and job diagnostics; no credentials or response bodies are logged.");
    process.exitCode = 1;
  }
}
