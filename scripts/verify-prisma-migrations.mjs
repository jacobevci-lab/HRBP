import { spawnSync } from "node:child_process";
import { Client } from "pg";

const BASELINE = "20261007000000_baseline_current_schema";
const rootUrl = process.env.DATABASE_URL;
if (!rootUrl) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const parsed = new URL(rootUrl);
const adminUrl = new URL(rootUrl);
adminUrl.pathname = "/postgres";

const dbNames = {
  fresh: "hrbp_migration_fresh",
  legacy: "hrbp_migration_legacy",
  drift: "hrbp_migration_drift",
  shadow: "hrbp_migration_shadow"
};

function urlFor(name) {
  const url = new URL(rootUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function run(command, args, { env = process.env, expected = [0], quiet = false } = {}) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (!expected.includes(status)) {
    if (quiet) {
      process.stdout.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
    }
    throw new Error(`${command} ${args.join(" ")} exited with ${status}`);
  }
  return { status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function prisma(args, options = {}) {
  return run(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], options);
}

async function adminQuery(sql) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function dbQuery(name, sql) {
  const client = new Client({ connectionString: urlFor(name) });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function recreate(name) {
  await adminQuery(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name.replaceAll("'", "''")}' AND pid <> pg_backend_pid();`);
  await adminQuery(`DROP DATABASE IF EXISTS "${name.replaceAll('"', '""')}";`);
  await adminQuery(`CREATE DATABASE "${name.replaceAll('"', '""')}";`);
}

async function drop(name) {
  await adminQuery(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name.replaceAll("'", "''")}' AND pid <> pg_backend_pid();`);
  await adminQuery(`DROP DATABASE IF EXISTS "${name.replaceAll('"', '""')}";`);
}

for (const name of Object.values(dbNames)) await recreate(name);

try {
  console.log("Verifying committed migrations build an empty database...");
  prisma(["migrate", "deploy", "--schema", "prisma"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.fresh) }
  });
  const freshHistory = await dbQuery(
    dbNames.fresh,
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active
     FROM "_prisma_migrations"
     ORDER BY started_at`
  );
  if (!freshHistory.rows.some((row) => row.migration_name === BASELINE && row.finished && row.active)) {
    throw new Error("Fresh migration deployment did not record the committed baseline as applied.");
  }

  console.log("Verifying migration history and Prisma datamodel are drift-free...");
  prisma([
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma",
    "--shadow-database-url",
    urlFor(dbNames.shadow),
    "--exit-code"
  ]);

  console.log("Verifying exact legacy schema can be adopted without replaying baseline SQL...");
  prisma(["db", "push", "--skip-generate", "--schema", "prisma"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.legacy) }
  });
  run(process.execPath, ["scripts/onprem-migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.legacy) }
  });
  const legacyHistory = await dbQuery(
    dbNames.legacy,
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active
     FROM "_prisma_migrations"
     ORDER BY started_at`
  );
  if (!legacyHistory.rows.some((row) => row.migration_name === BASELINE && row.finished && row.active)) {
    throw new Error("Legacy baseline adoption did not record the baseline migration.");
  }

  console.log("Verifying schema drift blocks legacy baseline adoption...");
  prisma(["db", "push", "--skip-generate", "--schema", "prisma"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.drift) }
  });
  await dbQuery(dbNames.drift, 'ALTER TABLE "Tenant" ADD COLUMN "migration_drift_probe" TEXT;');
  const rejected = run(process.execPath, ["scripts/onprem-migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.drift) },
    expected: [1],
    quiet: true
  });
  if (!/schema differs|No baseline marker was written/i.test(rejected.stderr + rejected.stdout)) {
    throw new Error("Drifted legacy database failed, but not through the expected fail-closed parity gate.");
  }
  const migrationTable = await dbQuery(
    dbNames.drift,
    `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`
  );
  if (migrationTable.rows[0]?.present) {
    throw new Error("Drifted legacy database was incorrectly marked with migration history.");
  }

  console.log("Prisma migration verification passed: fresh deploy, history drift check, exact legacy adoption and drift refusal.");
} finally {
  for (const name of Object.values(dbNames)) {
    try { await drop(name); } catch (error) { console.error(`Cleanup warning for ${name}:`, error); }
  }
}
