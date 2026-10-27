import { parseIntervalSeconds, readStateFile, schedulerHealth } from "./onprem-maintenance-state.mjs";

try {
  const dir = process.env.HRBP_AUDIT_HISTORY_STATE_DIR || "/var/lib/hrbp-audit-history-scheduler";
  const intervalSeconds = parseIntervalSeconds(process.env.HRBP_AUDIT_HISTORY_SCHEDULER_INTERVAL_SECONDS);
  const [heartbeat, lastRun] = await Promise.all([
    readStateFile(dir, "heartbeat.json"),
    readStateFile(dir, "last-run.json")
  ]);
  const result = schedulerHealth({ blocked: null, heartbeat, lastRun, intervalSeconds });
  if (!result.healthy) {
    console.error("AUDIT_HISTORY_" + result.code);
    process.exit(1);
  }
  console.log("AUDIT_HISTORY_" + result.code);
} catch {
  console.error("AUDIT_HISTORY_SCHEDULER_HEALTH_CHECK_FAILED");
  process.exit(1);
}
