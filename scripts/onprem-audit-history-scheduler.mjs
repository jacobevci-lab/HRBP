import { ensureStateDir, parseIntervalSeconds, writeStateFile } from "./onprem-maintenance-state.mjs";
import { runAuditHistoryMaintenance } from "./run-audit-history-maintenance.mjs";

const stateDir = process.env.HRBP_AUDIT_HISTORY_STATE_DIR || "/var/lib/hrbp-audit-history-scheduler";
const intervalSeconds = parseIntervalSeconds(process.env.HRBP_AUDIT_HISTORY_SCHEDULER_INTERVAL_SECONDS);
const url = process.env.HRBP_AUDIT_HISTORY_URL || "http://app:3000/api/internal/audit-history";
const token = process.env.HRBP_MAINTENANCE_TOKEN;

if (typeof token !== "string" || token.length < 24) {
  console.error("Audit history scheduler requires HRBP_MAINTENANCE_TOKEN with at least 24 characters.");
  process.exit(1);
}
await ensureStateDir(stateDir);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; });

async function heartbeat(status) {
  await writeStateFile(stateDir, "heartbeat.json", {
    at: new Date().toISOString(), status, pid: process.pid, intervalSeconds
  });
}
async function sleep(seconds, status) {
  const deadline = Date.now() + seconds * 1000;
  while (!stopping && Date.now() < deadline) {
    await heartbeat(status);
    await new Promise(resolve => setTimeout(resolve,
      Math.min(60_000, Math.max(1_000, deadline - Date.now()))));
  }
}

console.log(JSON.stringify({ event: "audit-history-scheduler-start", intervalSeconds, privateService: "app:3000" }));

while (!stopping) {
  await heartbeat("running");
  let result;
  try {
    result = await runAuditHistoryMaintenance({
      url, token, privateHttpHost: "app", timeoutMs: 90_000
    });
  } catch {
    result = { success: false, ambiguous: false, code: "AUDIT_HISTORY_SCHEDULER_CONFIGURATION_ERROR" };
  }

  const evidence = {
    completedAt: new Date().toISOString(),
    success: result.success === true,
    ambiguous: result.ambiguous === true,
    ...(Number.isInteger(result.httpStatus) ? { httpStatus: result.httpStatus } : {}),
    ...(Number.isFinite(result.durationMs) ? { durationMs: Math.max(0, Math.round(result.durationMs)) } : {}),
    ...(typeof result.code === "string" ? { code: result.code } : {}),
    ...(typeof result.outcome === "string" ? { outcome: result.outcome } : {}),
    ...(Number.isSafeInteger(result.eventsChecked) ? { eventsChecked: result.eventsChecked } : {}),
    ...(typeof result.cycleCompleted === "boolean" ? { cycleCompleted: result.cycleCompleted } : {})
  };
  await writeStateFile(stateDir, "last-run.json", evidence);
  console.log(JSON.stringify({ event: "audit-history-cycle", ...evidence }));

  // No immediate POST retry for an unknown outcome. Database-fenced progress
  // makes the next normal cycle resume safely from the last committed state.
  await sleep(intervalSeconds, evidence.success ? "idle" : evidence.ambiguous ? "unknown-outcome" : "failed");
}

await heartbeat("stopping");
console.log(JSON.stringify({ event: "audit-history-scheduler-stop" }));
