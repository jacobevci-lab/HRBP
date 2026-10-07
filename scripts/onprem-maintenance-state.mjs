import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_INTERVAL_SECONDS = 900;
export const MIN_INTERVAL_SECONDS = 300;
export const MAX_INTERVAL_SECONDS = 86_400;
export const AMBIGUOUS_STOP_CODES = Object.freeze([
  "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY",
  "UNEXPECTED_RESPONSE_STOPPED"
]);

export function schedulerStateDir(env = process.env) {
  return env.HRBP_MAINTENANCE_STATE_DIR || "/var/lib/hrbp-scheduler";
}

export function parseIntervalSeconds(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_INTERVAL_SECONDS;
  if (!/^[0-9]+$/.test(String(value))) throw new Error("Maintenance interval must be an integer number of seconds.");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < MIN_INTERVAL_SECONDS || seconds > MAX_INTERVAL_SECONDS) {
    throw new Error(`Maintenance interval must be between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS} seconds.`);
  }
  return seconds;
}

export function ambiguousStop(report) {
  if (!report?.stopped || !Array.isArray(report.results)) return null;
  const entry = report.results.find((result) => AMBIGUOUS_STOP_CODES.includes(result?.code));
  return entry ? { job: entry.job, code: entry.code } : null;
}

export async function ensureStateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function readStateFile(dir, name) {
  try {
    const raw = await readFile(path.join(dir, name), "utf8");
    if (raw.length > 64 * 1024) throw new Error("Scheduler state file is unexpectedly large.");
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeStateFile(dir, name, value) {
  await ensureStateDir(dir);
  const target = path.join(dir, name);
  const temporary = path.join(dir, `.${name}.${process.pid}.tmp`);
  const payload = JSON.stringify(value) + "\n";
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function removeStateFile(dir, name) {
  await rm(path.join(dir, name), { force: true });
}

export function boundedRunEvidence(report, completedAt = new Date()) {
  return {
    completedAt: completedAt.toISOString(),
    success: report?.success === true,
    stopped: report?.stopped === true,
    requested: Number.isInteger(report?.requested) ? report.requested : null,
    results: Array.isArray(report?.results)
      ? report.results.slice(0, 32).map((result) => ({
          job: typeof result?.job === "string" ? result.job : "unknown",
          status: result?.status === "success" ? "success" : "failed",
          ...(Number.isInteger(result?.httpStatus) ? { httpStatus: result.httpStatus } : {}),
          ...(Number.isFinite(result?.durationMs) && result.durationMs >= 0 ? { durationMs: Math.round(result.durationMs) } : {}),
          ...(typeof result?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(result.code) ? { code: result.code } : {})
        }))
      : []
  };
}

export function schedulerHealth({ blocked, heartbeat, lastRun, intervalSeconds, now = Date.now() }) {
  if (blocked) return { healthy: false, code: "BLOCKED_UNKNOWN_OUTCOME" };
  if (!heartbeat?.at || Number.isNaN(Date.parse(heartbeat.at))) return { healthy: false, code: "HEARTBEAT_MISSING" };
  const ageMs = Math.max(0, now - Date.parse(heartbeat.at));
  const maxAgeMs = Math.max(intervalSeconds * 2 * 1000 + 120_000, 900_000);
  if (ageMs > maxAgeMs) return { healthy: false, code: "HEARTBEAT_STALE" };
  if (lastRun && lastRun.success !== true) return { healthy: false, code: "LAST_RUN_FAILED" };
  return { healthy: true, code: "OK" };
}
