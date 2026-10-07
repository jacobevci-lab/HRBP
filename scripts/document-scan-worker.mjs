import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { clamdPing, clamdScanBuffer, clamdVersion } from "./clamd-client.mjs";

function numberEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

const endpoint = new URL(process.env.HRBP_DOCUMENT_SCAN_URL || "http://app:3000/api/internal/document-scan");
const privateHttp = endpoint.protocol === "http:" &&
  endpoint.hostname === "app" &&
  endpoint.port === "3000" &&
  endpoint.pathname === "/api/internal/document-scan";
const secureExternal = endpoint.protocol === "https:" &&
  endpoint.pathname === "/api/internal/document-scan";
if ((!privateHttp && !secureExternal) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  console.error("Document scanner endpoint must be the pinned private app service or an exact HTTPS internal scan endpoint.");
  process.exit(1);
}

const token = process.env.HRBP_DOCUMENT_SCAN_TOKEN;
if (typeof token !== "string" || token.length < 24) {
  console.error("Document scanner requires HRBP_DOCUMENT_SCAN_TOKEN with at least 24 characters.");
  process.exit(1);
}

const pollSeconds = numberEnv("HRBP_DOCUMENT_SCAN_POLL_SECONDS", 10, 2, 300);
const requestTimeoutMs = numberEnv("HRBP_DOCUMENT_SCAN_REQUEST_TIMEOUT_MS", 30000, 3000, 120000);
const maxBytes = numberEnv("HRBP_DOCUMENT_SCAN_MAX_BYTES", 30 * 1024 * 1024, 1024, 100 * 1024 * 1024);
const stateDir = process.env.HRBP_DOCUMENT_SCAN_STATE_DIR || "/var/run/hrbp-scanner";
const heartbeatPath = path.join(stateDir, "heartbeat.json");

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; });

async function heartbeat(status, detail = null) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temporary = heartbeatPath + "." + process.pid + ".tmp";
  const payload = JSON.stringify({
    at: new Date().toISOString(),
    status,
    ...(detail ? { detail } : {})
  }) + "\n";
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, heartbeatPath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(payload, timeoutMs = requestTimeoutMs) {
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error("SCAN_API_RESPONSE_TOO_LARGE");
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { throw new Error("SCAN_API_INVALID_JSON"); }
  }
  return { response, body };
}

async function claim() {
  const { response, body } = await postJson({ action: "claim" });
  if (!response.ok) throw new Error("SCAN_API_CLAIM_FAILED");
  return body?.data?.job ?? null;
}

async function readBoundedBody(response, limit) {
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared && (!Number.isInteger(declared) || declared < 0 || declared > limit)) {
    throw new Error("SCAN_OBJECT_TOO_LARGE");
  }
  if (!response.body) throw new Error("SCAN_OBJECT_EMPTY");

  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (!item.value?.length) continue;
      length += item.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("SCAN_OBJECT_TOO_LARGE");
      }
      chunks.push(Buffer.from(item.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new Error("SCAN_OBJECT_EMPTY");
  return Buffer.concat(chunks, length);
}

async function download(job) {
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/octet-stream"
    },
    body: JSON.stringify({ action: "download", versionId: job.versionId, attempt: job.attempt }),
    signal: AbortSignal.timeout(Math.max(requestTimeoutMs, 60000))
  });
  if (!response.ok) throw new Error("SCAN_OBJECT_FETCH_FAILED");
  const bytes = await readBoundedBody(response, maxBytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const expectedHeader = response.headers.get("x-content-sha256");
  if (expectedHeader && expectedHeader !== job.contentHash) throw new Error("SCAN_OBJECT_METADATA_MISMATCH");
  return { bytes, hash };
}

async function complete(job, status, engine, reference, message) {
  const { response } = await postJson({
    action: "complete",
    versionId: job.versionId,
    attempt: job.attempt,
    status,
    engine,
    reference,
    message
  });
  if (!response.ok) throw new Error("SCAN_API_COMPLETE_FAILED");
}

async function release(job, reason) {
  try {
    const { response } = await postJson({
      action: "release",
      versionId: job.versionId,
      attempt: job.attempt,
      reason
    });
    return response.status === 200 || response.status === 409;
  } catch {
    return false;
  }
}

async function processJob(job) {
  if (!job || typeof job.versionId !== "string" || typeof job.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(job.contentHash)) {
    throw new Error("SCAN_JOB_INVALID");
  }

  await heartbeat("scanning");
  let downloaded;
  try {
    downloaded = await download(job);
  } catch (error) {
    await release(job, error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "SCAN_OBJECT_FETCH_FAILED");
    return { state: "released" };
  }

  const expectedSize = job.sizeBytes === null || job.sizeBytes === undefined ? null : Number(job.sizeBytes);
  if (downloaded.hash.toLowerCase() !== job.contentHash.toLowerCase() ||
      (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && expectedSize !== downloaded.bytes.length)) {
    try {
      await complete(
        job,
        "QUARANTINED",
        "HRBP Integrity Gate",
        "CONTENT_INTEGRITY_MISMATCH",
        "Stored object failed integrity verification before malware scan"
      );
      return { state: "quarantined-integrity" };
    } catch {
      await release(job, "SCAN_COMPLETION_UNKNOWN");
      return { state: "completion-unknown" };
    }
  }

  let engine = "ClamAV";
  try {
    await clamdPing();
    engine = await clamdVersion().catch(() => "ClamAV");
    const result = await clamdScanBuffer(downloaded.bytes);
    if (result.kind === "clean") {
      await complete(job, "CLEAN", engine, null, "No malware detected");
      return { state: "clean" };
    }
    if (result.kind === "infected") {
      await complete(job, "QUARANTINED", engine, result.signature, "Malware signature detected");
      return { state: "quarantined-malware" };
    }
    await complete(job, "FAILED", engine, result.code, "Malware engine could not establish a clean verdict");
    return { state: "failed-verdict" };
  } catch (error) {
    const reason = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "CLAMD_UNAVAILABLE";
    await release(job, reason);
    return { state: "released" };
  }
}

console.log(JSON.stringify({ event: "document-scanner-start", pollSeconds }));

while (!stopping) {
  await heartbeat("polling");
  let job = null;
  try {
    job = await claim();
  } catch {
    await heartbeat("claim-unavailable");
    await sleep(pollSeconds * 1000);
    continue;
  }

  if (!job) {
    await heartbeat("idle");
    await sleep(pollSeconds * 1000);
    continue;
  }

  const result = await processJob(job).catch(async () => {
    await release(job, "SCANNER_WORKER_FAILURE");
    return { state: "released" };
  });
  console.log(JSON.stringify({ event: "document-scan-cycle", state: result.state }));
}

await heartbeat("stopping");
console.log(JSON.stringify({ event: "document-scanner-stop" }));
