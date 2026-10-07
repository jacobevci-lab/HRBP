import {
  parseIntervalSeconds,
  readStateFile,
  schedulerHealth,
  schedulerStateDir
} from "./onprem-maintenance-state.mjs";

try {
  const dir = schedulerStateDir();
  const intervalSeconds = parseIntervalSeconds(process.env.HRBP_MAINTENANCE_INTERVAL_SECONDS);
  const [blocked, heartbeat, lastRun] = await Promise.all([
    readStateFile(dir, "blocked.json"),
    readStateFile(dir, "heartbeat.json"),
    readStateFile(dir, "last-run.json")
  ]);
  const result = schedulerHealth({ blocked, heartbeat, lastRun, intervalSeconds });
  if (!result.healthy) {
    console.error(result.code);
    process.exit(1);
  }
  console.log(result.code);
} catch {
  console.error("SCHEDULER_HEALTH_CHECK_FAILED");
  process.exit(1);
}
