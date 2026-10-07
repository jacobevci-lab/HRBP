import { runMaintenance } from "./run-operational-maintenance.mjs";
import {
  ambiguousStop,
  boundedRunEvidence,
  ensureStateDir,
  parseIntervalSeconds,
  readStateFile,
  schedulerStateDir,
  writeStateFile
} from "./onprem-maintenance-state.mjs";

const stateDir = schedulerStateDir();
const intervalSeconds = parseIntervalSeconds(process.env.HRBP_MAINTENANCE_INTERVAL_SECONDS);
const url = process.env.HRBP_MAINTENANCE_URL || "http://app:3000/api/internal/maintenance";
const token = process.env.HRBP_MAINTENANCE_TOKEN;
const privateHttpHost = "app";

if (typeof token !== "string" || token.length < 24) {
  console.error("Maintenance scheduler requires HRBP_MAINTENANCE_TOKEN with at least 24 characters.");
  process.exit(1);
}

await ensureStateDir(stateDir);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { stopping = true; });
}

async function heartbeat(status, extra = {}) {
  await writeStateFile(stateDir, "heartbeat.json", {
    at: new Date().toISOString(),
    status,
    pid: process.pid,
    intervalSeconds,
    ...extra
  });
}

async function sleepWithHeartbeat(seconds, status) {
  const deadline = Date.now() + seconds * 1000;
  while (!stopping && Date.now() < deadline) {
    await heartbeat(status);
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, Math.max(1_000, remaining))));
  }
}

console.log(JSON.stringify({ event: "scheduler-start", intervalSeconds, privateService: "app:3000" }));

while (!stopping) {
  const blocked = await readStateFile(stateDir, "blocked.json");
  if (blocked) {
    await heartbeat("blocked", { blockedCode: blocked.code || "UNKNOWN" });
    await sleepWithHeartbeat(60, "blocked");
    continue;
  }

  await heartbeat("running");
  let report;
  try {
    report = await runMaintenance({
      url,
      token,
      privateHttpHost,
      timeoutMs: 90_000,
      log: (result) => console.log(JSON.stringify({ event: "maintenance-job", ...result }))
    });
  } catch {
    const evidence = {
      completedAt: new Date().toISOString(),
      success: false,
      stopped: true,
      requested: null,
      results: [{ job: "scheduler", status: "failed", code: "SCHEDULER_CONFIGURATION_OR_RUNTIME_ERROR" }]
    };
    await writeStateFile(stateDir, "last-run.json", evidence);
    console.error("Maintenance scheduler cycle failed before a verified maintenance report was produced.");
    await sleepWithHeartbeat(intervalSeconds, "failed");
    continue;
  }

  const evidence = boundedRunEvidence(report);
  await writeStateFile(stateDir, "last-run.json", evidence);

  const ambiguous = ambiguousStop(report);
  if (ambiguous) {
    const blockedEvidence = {
      at: new Date().toISOString(),
      reason: "A maintenance POST outcome could not be verified. Automatic execution is latched off until an operator inspects application state and explicitly resumes.",
      job: ambiguous.job,
      code: ambiguous.code
    };
    await writeStateFile(stateDir, "blocked.json", blockedEvidence);
    console.error(JSON.stringify({ event: "scheduler-blocked", job: ambiguous.job, code: ambiguous.code }));
    await sleepWithHeartbeat(60, "blocked");
    continue;
  }

  console.log(JSON.stringify({
    event: "maintenance-cycle",
    success: evidence.success,
    stopped: evidence.stopped,
    requested: evidence.requested,
    completedAt: evidence.completedAt
  }));

  await sleepWithHeartbeat(intervalSeconds, evidence.success ? "idle" : "failed");
}

await heartbeat("stopping");
console.log(JSON.stringify({ event: "scheduler-stop" }));
