import { spawnSync } from "node:child_process";
import { Client } from "pg";

const BASELINE = "20261007000000_baseline_current_schema";
const schemaPath = "prisma";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function prisma(args, { allowExitCodes = [0] } = {}) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["prisma", ...args], {
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (!allowExitCodes.includes(result.status ?? 1)) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 1;
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL is required.");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let migrationTable = false;
let userTableCount = 0;
try {
  const migrationResult = await client.query(
    "select to_regclass('public._prisma_migrations') is not null as present"
  );
  migrationTable = migrationResult.rows[0]?.present === true;

  const countResult = await client.query(
    "select count(*)::int as count from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'"
  );
  userTableCount = Number(countResult.rows[0]?.count ?? 0);
} finally {
  await client.end();
}

if (migrationTable) {
  console.log("Prisma migration history detected; deploying pending migrations.");
  prisma(["migrate", "deploy", "--schema", schemaPath]);
  process.exit(0);
}

if (userTableCount === 0) {
  console.log("Empty database detected; applying committed migration history.");
  prisma(["migrate", "deploy", "--schema", schemaPath]);
  process.exit(0);
}

console.log(
  `Legacy database without Prisma migration history detected (${userTableCount} public tables). Verifying exact schema parity before baseline adoption.`
);

const diffStatus = prisma(
  [
    "migrate",
    "diff",
    "--from-url",
    process.env.DATABASE_URL,
    "--to-schema-datamodel",
    schemaPath,
    "--exit-code"
  ],
  { allowExitCodes: [0, 2] }
);

if (diffStatus === 2) {
  fail(
    "Legacy database schema differs from the committed Prisma schema. No baseline marker was written. Restore/reconcile through a vendor-reviewed migration plan."
  );
}

console.log(`Schema parity verified; marking ${BASELINE} as already applied.`);
prisma(["migrate", "resolve", "--applied", BASELINE, "--schema", schemaPath]);
prisma(["migrate", "deploy", "--schema", schemaPath]);
console.log("Versioned migration deployment completed.");
