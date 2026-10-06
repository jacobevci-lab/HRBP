import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  baseline,
  lock,
  dockerfile,
  deployHelper,
  packageJson,
  ci,
  staging,
  docs
] = await Promise.all([
  readFile("prisma/migrations/0_baseline/migration.sql", "utf8"),
  readFile("prisma/migrations/migration_lock.toml", "utf8"),
  readFile("Dockerfile.onprem", "utf8"),
  readFile("scripts/schema-migrate-deploy.sh", "utf8"),
  readFile("package.json", "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/staging-db-sync.yml", "utf8"),
  readFile("docs/DATABASE-MIGRATIONS.md", "utf8")
]);

assert.match(lock, /^provider\s*=\s*"postgresql"\s*$/m, "Prisma migration lock must pin PostgreSQL.");
assert.ok(baseline.trim().length > 1000, "Baseline migration is unexpectedly small.");

for (const table of [
  "Tenant",
  "UserAccount",
  "Employment",
  "TimeEntry",
  "PayrollRun",
  "AuditEvent",
  "DocumentVersion",
  "SeparationProcess",
  "HRServiceStatusTransition",
  "EmployeeCaseStatusTransition"
]) {
  assert.ok(
    baseline.includes(`CREATE TABLE "${table}"`),
    `Baseline migration is missing the ${table} table from the multi-file Prisma schema.`
  );
}

for (const forbidden of [
  /DROP\s+DATABASE/i,
  /TRUNCATE\s+/i,
  /--accept-data-loss/i,
  /migrate\s+reset/i
]) {
  assert.ok(!forbidden.test(baseline), `Unsafe baseline token found: ${forbidden}`);
  assert.ok(!forbidden.test(deployHelper), `Unsafe deploy-helper token found: ${forbidden}`);
}

for (const token of [
  'BASELINE_MIGRATION="0_baseline"',
  "--to-schema-datamodel",
  "prisma migrate resolve --applied",
  "prisma migrate deploy",
  "database schema differs from the approved baseline"
]) {
  assert.ok(deployHelper.includes(token), `Migration deploy helper is missing: ${token}`);
}

assert.match(
  dockerfile,
  /FROM builder AS schema[\s\S]*schema-migrate-deploy\.sh/,
  "On-prem schema image must use the guarded versioned migration deploy helper."
);
assert.ok(!/FROM builder AS schema[\s\S]*db:push/.test(dockerfile), "On-prem schema image must not use db push.");

const pkg = JSON.parse(packageJson);
assert.equal(pkg.scripts?.["db:migrate:deploy"], "prisma migrate deploy");
assert.equal(pkg.scripts?.["db:migrate:status"], "prisma migrate status");
assert.equal(pkg.scripts?.["db:migrations:validate"], "node scripts/validate-prisma-migrations.mjs");
assert.ok(pkg.scripts?.prebuild?.includes("db:migrations:validate"), "Migration validation must be a prebuild gate.");

assert.ok(ci.includes("npx prisma migrate deploy"), "CI must initialize its database through committed migrations.");
assert.ok(!ci.includes("Prepare CI database\n        run: npx prisma db push"), "CI database preparation must not use db push.");

assert.ok(staging.includes("bash scripts/schema-migrate-deploy.sh"), "Staging sync must use guarded migration deployment.");
assert.ok(!staging.includes("run: npx prisma db push"), "Staging must not mutate schema through db push.");

for (const token of [
  "0_baseline",
  "schema-migrate-deploy.sh",
  "migrate resolve",
  "migrate deploy",
  "exact match",
  "migrate reset",
  "accept-data-loss"
]) {
  assert.ok(docs.toLowerCase().includes(token.toLowerCase()), `Migration runbook is missing: ${token}`);
}

console.log("Versioned Prisma migration policy validation passed.");
