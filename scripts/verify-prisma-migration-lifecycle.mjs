import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { BASELINE_MIGRATION, PRISMA_SCHEMA_PATH } from "./prisma-migration-contract.mjs";

const rootUrl = process.env.DATABASE_URL;
if (!rootUrl) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const suffix = `${process.pid}_${Date.now()}`;
const names = {
  fresh: `hrbp_migration_fresh_${suffix}`,
  legacy: `hrbp_migration_legacy_${suffix}`,
  drift: `hrbp_migration_drift_${suffix}`
};

function databaseUrl(name) {
  const url = new URL(rootUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function quoteIdent(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Unsafe database identifier: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}

function run(command, args, { databaseUrl: url = rootUrl, expect = [0], quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url },
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (!expect.includes(status)) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} exited ${status}; expected ${expect.join("/")}`);
  }
  if (!quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return { status, stdout: result.stdout, stderr: result.stderr };
}

function prisma(args, options = {}) {
  return run(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], options);
}

function node(args, options = {}) {
  return run(process.execPath, args, options);
}

async function query(url, sql) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

const admin = new Client({ connectionString: rootUrl });
await admin.connect();

async function dropDatabase(name) {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
}

async function createDatabase(name) {
  await dropDatabase(name);
  await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
}

async function hasMigrationTable(url) {
  const result = await query(url, "select to_regclass('public._prisma_migrations') is not null as present");
  return result.rows[0]?.present === true;
}

async function assertBaselineApplied(url) {
  const result = await query(
    url,
    `select migration_name, finished_at, rolled_back_at
       from "_prisma_migrations"
      where migration_name = '${BASELINE_MIGRATION.replaceAll("'", "''")}'`
  );
  if (result.rowCount !== 1) throw new Error("Baseline migration history row is missing or duplicated.");
  const row = result.rows[0];
  if (!row.finished_at || row.rolled_back_at) throw new Error("Baseline migration is not recorded as successfully applied.");
}

async function assertSchemaParity(url) {
  prisma(
    [
      "migrate",
      "diff",
      "--from-schema-datasource",
      PRISMA_SCHEMA_PATH,
      "--to-schema-datamodel",
      PRISMA_SCHEMA_PATH,
      "--exit-code"
    ],
    { databaseUrl: url, quiet: true }
  );
}

try {
  console.log("[migration] fresh database -> migrate deploy");
  await createDatabase(names.fresh);
  const freshUrl = databaseUrl(names.fresh);
  prisma(["migrate", "deploy", "--schema", PRISMA_SCHEMA_PATH], { databaseUrl: freshUrl, quiet: true });
  if (!(await hasMigrationTable(freshUrl))) throw new Error("Fresh migration deploy did not create migration history.");
  await assertBaselineApplied(freshUrl);
  await assertSchemaParity(freshUrl);

  console.log("[migration] existing migration history -> idempotent deploy");
  node(["scripts/deploy-prisma-migrations.mjs"], { databaseUrl: freshUrl, quiet: true });
  await assertBaselineApplied(freshUrl);
  await assertSchemaParity(freshUrl);

  console.log("[migration] legacy exact schema -> guarded baseline adoption");
  await createDatabase(names.legacy);
  const legacyUrl = databaseUrl(names.legacy);
  prisma(["db", "push", "--skip-generate", "--schema", PRISMA_SCHEMA_PATH], { databaseUrl: legacyUrl, quiet: true });
  if (await hasMigrationTable(legacyUrl)) throw new Error("Legacy fixture unexpectedly has migration history before adoption.");
  node(["scripts/deploy-prisma-migrations.mjs"], { databaseUrl: legacyUrl, quiet: true });
  await assertBaselineApplied(legacyUrl);
  await assertSchemaParity(legacyUrl);

  console.log("[migration] legacy drift -> fail closed without baseline marker");
  await createDatabase(names.drift);
  const driftUrl = databaseUrl(names.drift);
  prisma(["db", "push", "--skip-generate", "--schema", PRISMA_SCHEMA_PATH], { databaseUrl: driftUrl, quiet: true });
  await query(driftUrl, "create table migration_drift_probe (id integer primary key)");
  const driftAttempt = node(
    ["scripts/deploy-prisma-migrations.mjs"],
    { databaseUrl: driftUrl, expect: [1, 2], quiet: true }
  );
  if (driftAttempt.status === 0) throw new Error("Drifted legacy database was incorrectly accepted.");
  if (await hasMigrationTable(driftUrl)) {
    throw new Error("Drifted legacy database received migration history despite failed parity.");
  }

  console.log("Prisma migration lifecycle verification passed.");
} finally {
  for (const name of Object.values(names)) {
    try {
      await dropDatabase(name);
    } catch (error) {
      console.error(`Cleanup failed for ${name}:`, error);
    }
  }
  await admin.end();
}
