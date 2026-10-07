import { readFile } from "node:fs/promises";
import path from "node:path";
import { clamdPing } from "./clamd-client.mjs";

function numberEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

const pollSeconds = numberEnv("HRBP_DOCUMENT_SCAN_POLL_SECONDS", 10, 2, 300);
const stateDir = process.env.HRBP_DOCUMENT_SCAN_STATE_DIR || "/var/run/hrbp-scanner";
const heartbeatPath = path.join(stateDir, "heartbeat.json");

try {
  const raw = await readFile(heartbeatPath, "utf8");
  if (raw.length > 16 * 1024) throw new Error("HEARTBEAT_TOO_LARGE");
  const heartbeat = JSON.parse(raw);
  const at = typeof heartbeat?.at === "string" ? Date.parse(heartbeat.at) : NaN;
  const maxAgeMs = Math.max(180000, (pollSeconds * 2 + 60) * 1000);
  if (!Number.isFinite(at) || Date.now() - at > maxAgeMs) throw new Error("HEARTBEAT_STALE");
  if (["stopping", "claim-unavailable"].includes(heartbeat?.status)) throw new Error("WORKER_NOT_READY");
  await clamdPing();
  console.log("OK");
} catch {
  console.error("DOCUMENT_SCANNER_UNHEALTHY");
  process.exit(1);
}
