import {
  readStateFile,
  removeStateFile,
  schedulerStateDir
} from "./onprem-maintenance-state.mjs";

const dir = schedulerStateDir();
const [command, acknowledgement] = process.argv.slice(2);

if (!command || !["status", "resume"].includes(command)) {
  console.error("Usage: node scripts/onprem-maintenance-control.mjs status | resume --acknowledge-unknown");
  process.exit(64);
}

if (command === "status") {
  const [blocked, heartbeat, lastRun] = await Promise.all([
    readStateFile(dir, "blocked.json"),
    readStateFile(dir, "heartbeat.json"),
    readStateFile(dir, "last-run.json")
  ]);
  console.log(JSON.stringify({ blocked, heartbeat, lastRun }, null, 2));
  process.exit(0);
}

if (acknowledgement !== "--acknowledge-unknown") {
  console.error("Resume requires --acknowledge-unknown after an operator has inspected the ambiguous outcome.");
  process.exit(64);
}

const blocked = await readStateFile(dir, "blocked.json");
if (!blocked) {
  console.log("Scheduler is not blocked; no latch was removed.");
  process.exit(0);
}

await removeStateFile(dir, "blocked.json");
console.log(JSON.stringify({
  resumed: true,
  previous: {
    at: blocked.at ?? null,
    job: blocked.job ?? null,
    code: blocked.code ?? null
  }
}));
