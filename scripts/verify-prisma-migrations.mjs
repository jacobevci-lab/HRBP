import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { BASELINE_MIGRATION, PRISMA_BASELINE_SCHEMA_PATH, PRISMA_SCHEMA_PATH } from "./prisma-migration-contract.mjs";

const rootUrl = process.env.DATABASE_URL;
if (!rootUrl) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const suffix = `${process.pid}_${Date.now()}`;
const adminUrl = new URL(rootUrl);
adminUrl.pathname = "/postgres";

const dbNames = {
  fresh: `hrbp_migration_fresh_${suffix}`,
  legacy: `hrbp_migration_legacy_${suffix}`,
  drift: `hrbp_migration_drift_${suffix}`,
  shadow: `hrbp_migration_shadow_${suffix}`
};

function urlFor(name) {
  const url = new URL(rootUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function quoteIdent(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Unsafe database identifier: ${value}`);
  return `"${value}"`;
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
  const literal = name.replaceAll("'", "''");
  await adminQuery(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${literal}' AND pid <> pg_backend_pid();`);
  await adminQuery(`DROP DATABASE IF EXISTS ${quoteIdent(name)};`);
  await adminQuery(`CREATE DATABASE ${quoteIdent(name)};`);
}

async function drop(name) {
  const literal = name.replaceAll("'", "''");
  await adminQuery(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${literal}' AND pid <> pg_backend_pid();`);
  await adminQuery(`DROP DATABASE IF EXISTS ${quoteIdent(name)};`);
}

async function baselineRows(name) {
  return dbQuery(
    name,
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active
       FROM "_prisma_migrations"
      WHERE migration_name = '${BASELINE_MIGRATION.replaceAll("'", "''")}'
      ORDER BY started_at`
  );
}

for (const name of Object.values(dbNames)) await recreate(name);

try {
  console.log("Verifying committed migrations build an empty database...");
  prisma(["migrate", "deploy", "--schema", PRISMA_SCHEMA_PATH], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.fresh) },
    quiet: true
  });
  const freshHistory = await baselineRows(dbNames.fresh);
  if (freshHistory.rowCount !== 1 || !freshHistory.rows[0]?.finished || !freshHistory.rows[0]?.active) {
    throw new Error("Fresh migration deployment did not record exactly one successful baseline.");
  }

  console.log("Verifying migration history and Prisma datamodel are drift-free...");
  prisma([
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    PRISMA_SCHEMA_PATH,
    "--shadow-database-url",
    urlFor(dbNames.shadow),
    "--exit-code"
  ], { quiet: true });

  console.log("Verifying existing migration history is idempotent...");
  run(process.execPath, ["scripts/deploy-prisma-migrations.mjs"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.fresh) },
    quiet: true
  });
  const idempotentHistory = await baselineRows(dbNames.fresh);
  if (idempotentHistory.rowCount !== 1 || !idempotentHistory.rows[0]?.finished || !idempotentHistory.rows[0]?.active) {
    throw new Error("Idempotent migration deploy changed baseline history unexpectedly.");
  }

  console.log("Verifying immutable baseline-era schema can be adopted and then advanced through pending migrations...");
  prisma(["db", "push", "--skip-generate", "--schema", PRISMA_BASELINE_SCHEMA_PATH], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.legacy) },
    quiet: true
  });
  const beforeAdoption = await dbQuery(
    dbNames.legacy,
    "select to_regclass('public._prisma_migrations') is not null as present"
  );
  if (beforeAdoption.rows[0]?.present) throw new Error("Legacy fixture unexpectedly has migration history.");
  run(process.execPath, ["scripts/deploy-prisma-migrations.mjs"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.legacy) },
    quiet: true
  });
  const legacyHistory = await baselineRows(dbNames.legacy);
  if (legacyHistory.rowCount !== 1 || !legacyHistory.rows[0]?.finished || !legacyHistory.rows[0]?.active) {
    throw new Error("Legacy baseline adoption did not record exactly one successful baseline.");
  }

  console.log("Verifying adopted legacy database advances through all post-baseline migrations...");
  prisma([
    "migrate",
    "diff",
    "--from-schema-datasource",
    PRISMA_SCHEMA_PATH,
    "--to-schema-datamodel",
    PRISMA_SCHEMA_PATH,
    "--exit-code"
  ], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.legacy) },
    quiet: true
  });

  console.log("Verifying schema drift blocks legacy baseline adoption...");
  prisma(["db", "push", "--skip-generate", "--schema", PRISMA_BASELINE_SCHEMA_PATH], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.drift) },
    quiet: true
  });
  await dbQuery(dbNames.drift, 'ALTER TABLE "Tenant" ADD COLUMN "migration_drift_probe" TEXT;');
  const rejected = run(process.execPath, ["scripts/deploy-prisma-migrations.mjs"], {
    env: { ...process.env, DATABASE_URL: urlFor(dbNames.drift) },
    expected: [1, 2],
    quiet: true
  });
  if (!/schema differs|No baseline marker was written/i.test(rejected.stderr + rejected.stdout)) {
    throw new Error("Drifted legacy database failed, but not through the expected fail-closed parity gate.");
  }
  const migrationTable = await dbQuery(
    dbNames.drift,
    "select to_regclass('public._prisma_migrations') is not null as present"
  );
  if (migrationTable.rows[0]?.present) {
    throw new Error("Drifted legacy database was incorrectly marked with migration history.");
  }

  console.log("Prisma migration verification passed: fresh deploy, history parity, idempotency, legacy baseline adoption plus forward migration, and drift refusal.");
} finally {
  for (const name of Object.values(dbNames)) {
    try {
      await drop(name);
    } catch (error) {
      console.error(`Cleanup warning for ${name}:`, error);
    }
  }
}
