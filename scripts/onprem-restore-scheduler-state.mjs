import { readFile } from "node:fs/promises";
import {
  AMBIGUOUS_STOP_CODES,
  schedulerStateDir,
  writeStateFile
} from "./onprem-maintenance-state.mjs";

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/onprem-restore-scheduler-state.mjs /path/to/scheduler-status.json");
  process.exit(64);
}

let status;
try {
  const raw = await readFile(source, "utf8");
  if (raw.length > 64 * 1024) throw new Error("status too large");
  status = JSON.parse(raw);
} catch {
  console.error("Scheduler backup state is unreadable; existing safety latch was left unchanged.");
  process.exit(0);
}

const dir = schedulerStateDir();
if (status?.blocked && typeof status.blocked === "object" && !Array.isArray(status.blocked)) {
  const code = status.blocked.code;
  const job = status.blocked.job;
  if (!AMBIGUOUS_STOP_CODES.includes(code) || typeof job !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(job)) {
    console.error("Scheduler backup contains an invalid blocked latch; existing safety latch was left unchanged.");
    process.exit(0);
  }
  const at = typeof status.blocked.at === "string" && Number.isFinite(Date.parse(status.blocked.at))
    ? new Date(status.blocked.at).toISOString()
    : new Date().toISOString();
  await writeStateFile(dir, "blocked.json", {
    at,
    reason: "Restored backup recorded an ambiguous maintenance POST outcome. Inspect restored application state before explicitly resuming scheduled maintenance.",
    job,
    code,
    restoredFromBackup: true
  });
  console.log(JSON.stringify({ schedulerLatch: "restored-blocked", job, code }));
  process.exit(0);
}

if (status && Object.prototype.hasOwnProperty.call(status, "blocked") && status.blocked === null) {
  // Restore is deliberately monotonic for safety: an older unblocked backup must
  // never clear a newer unknown-outcome latch that may represent an external
  // side effect which database/object restore cannot reverse.
  console.log(JSON.stringify({ schedulerLatch: "unchanged", reason: "backup-was-unblocked" }));
  process.exit(0);
}

console.log(JSON.stringify({ schedulerLatch: "unchanged", reason: "backup-status-unavailable" }));
