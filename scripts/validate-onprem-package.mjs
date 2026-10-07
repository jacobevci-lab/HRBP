import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  compose,
  dockerfile,
  env,
  ignore,
  gitignore,
  gitAttributes,
  backup,
  restore,
  rehearsal,
  docs,
  packageJson,
  packageLock,
  migrationRunner,
  migrationVerifier,
  migrationContract,
  maintenanceRunner,
  maintenanceScheduler,
  maintenanceState,
  preflight,
  preflightTest,
  baselineSql,
  migrationLock
] = await Promise.all([
  readFile("docker-compose.onprem.yml", "utf8"),
  readFile("Dockerfile.onprem", "utf8"),
  readFile(".env.onprem.example", "utf8"),
  readFile(".dockerignore", "utf8"),
  readFile(".gitignore", "utf8"),
  readFile(".gitattributes", "utf8"),
  readFile("scripts/onprem-backup.sh", "utf8"),
  readFile("scripts/onprem-restore.sh", "utf8"),
  readFile("scripts/onprem-recovery-rehearsal.sh", "utf8"),
  readFile("docs/ONPREM-DEPLOYMENT.md", "utf8"),
  readFile("package.json", "utf8"),
  readFile("package-lock.json", "utf8"),
  readFile("scripts/deploy-prisma-migrations.mjs", "utf8"),
  readFile("scripts/verify-prisma-migrations.mjs", "utf8"),
  readFile("scripts/prisma-migration-contract.mjs", "utf8"),
  readFile("scripts/run-operational-maintenance.mjs", "utf8"),
  readFile("scripts/onprem-maintenance-scheduler.mjs", "utf8"),
  readFile("scripts/onprem-maintenance-state.mjs", "utf8"),
  readFile("scripts/onprem-preflight.mjs", "utf8"),
  readFile("scripts/onprem-preflight.test.mjs", "utf8"),
  readFile("prisma/migrations/20261007000000_baseline_current_schema/migration.sql", "utf8"),
  readFile("prisma/migrations/migration_lock.toml", "utf8")
]);

const required = [
  "postgres:", "object-storage:", "object-storage-tool:", "schema:", "app:", "maintenance-scheduler:",
  "service_completed_successfully", "service_healthy",
  "HRBP_ALLOW_INSECURE_CONTEXT_HEADERS: \"false\"",
  "/api/health/runtime", "target: runtime", "target: schema"
];
for (const token of required) assert.ok(compose.includes(token), `Missing on-prem compose contract: ${token}`);

const postgresBlock = (compose.split("\n  postgres:\n")[1] ?? "").split("\n  object-storage:\n")[0];
const objectStorageBlock = (compose.split("\n  object-storage:\n")[1] ?? "").split("\n  object-storage-tool:\n")[0];
assert.ok(postgresBlock, "PostgreSQL service block must be present.");
assert.ok(objectStorageBlock, "Embedded object-storage service block must be present.");
assert.ok(!/\n\s+ports:/.test(postgresBlock), "PostgreSQL must not publish a host port.");
assert.ok(!/\n\s+ports:/.test(objectStorageBlock), "Embedded object storage must not publish a host port.");
const schedulerBlock = (compose.split("\n  maintenance-scheduler:\n")[1] ?? "").split("\nvolumes:\n")[0];
assert.ok(schedulerBlock, "Maintenance scheduler service block must be present.");
assert.ok(!/\n\s+ports:/.test(schedulerBlock), "Maintenance scheduler must not publish a host port.");
for (const token of [
  "target: scheduler",
  "read_only: true",
  "no-new-privileges:true",
  "cap_drop:",
  "HRBP_MAINTENANCE_URL: http://app:3000/api/internal/maintenance",
  "HRBP_MAINTENANCE_TOKEN:?set HRBP_MAINTENANCE_TOKEN",
  "HRBP_MAINTENANCE_INTERVAL_SECONDS:-900",
  "scheduler_state:/var/lib/hrbp-scheduler",
  "condition: service_healthy"
]) assert.ok(schedulerBlock.includes(token), `Maintenance scheduler Compose contract missing: ${token}`);
assert.ok(compose.includes("scheduler_state:"), "Maintenance scheduler latch state must use a durable named volume.");

assert.ok(!compose.includes("--accept-data-loss"), "Schema bootstrap must never accept destructive changes automatically.");
assert.ok(compose.includes("POSTGRES_PASSWORD:?set POSTGRES_PASSWORD"));
assert.ok(compose.includes("OBJECT_STORAGE_ACCESS_KEY:?set OBJECT_STORAGE_ACCESS_KEY"));
assert.ok(compose.includes("OBJECT_STORAGE_SECRET_KEY:?set OBJECT_STORAGE_SECRET_KEY"));
assert.ok(compose.includes("chrislusf/seaweedfs:4.48"), "Bundled S3 service must use the reviewed pinned SeaweedFS release.");
assert.ok(compose.includes('command: ["mini", "-dir=/data", "-admin.port=12646"]'), "Single-host object storage must use explicit mini mode and a non-ephemeral admin port.");
assert.ok(compose.includes("S3_BUCKET: ${OBJECT_STORAGE_BUCKET:-hrbp-private}"));
assert.ok(compose.includes("rclone/rclone:1.75.1"), "Recovery tooling must use the reviewed pinned rclone release.");
assert.ok(compose.includes('profiles: ["tools"]'), "Recovery tool must not run during normal stack startup.");
assert.ok(compose.includes("RCLONE_CONFIG_HRBP_PROVIDER: Other"));
assert.ok(compose.includes('RCLONE_CONFIG_HRBP_FORCE_PATH_STYLE: "true"'));
assert.ok(compose.includes("OBJECT_STORAGE_ENDPOINT: ${OBJECT_STORAGE_ENDPOINT:-http://object-storage:8333}"));
assert.ok(compose.includes("APP_URL:?set APP_URL"));

assert.match(dockerfile, /COPY package\.json package-lock\.json/);
assert.match(dockerfile, /RUN npm ci/);
assert.match(dockerfile, /npm prune --omit=dev/);
assert.ok(dockerfile.includes("COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma"), "Generated Prisma client must be restored after production pruning.");
assert.match(dockerfile, /USER node/);
assert.match(dockerfile, /HEALTHCHECK[\s\S]*api\/health\/runtime/);
assert.match(dockerfile, /FROM builder AS schema/);
assert.match(dockerfile, /FROM base AS scheduler/);
assert.ok(dockerfile.includes('CMD ["node", "scripts/onprem-maintenance-scheduler.mjs"]'), "Scheduler image must start the bounded scheduler.");
assert.ok(dockerfile.includes("onprem-maintenance-health.mjs"), "Scheduler image must have its own health probe.");
assert.ok(dockerfile.includes("onprem-restore-scheduler-state.mjs"), "Scheduler image must include the restore latch helper.");
assert.ok(dockerfile.includes("/var/lib/hrbp-scheduler"), "Scheduler image must prepare durable state ownership.");
assert.ok(compose.includes("no-new-privileges:true") && compose.includes("cap_drop:"), "Application container must drop ambient Linux privileges.");
assert.ok(!dockerfile.includes("--accept-data-loss"));
assert.ok(dockerfile.includes('CMD ["node", "scripts/deploy-prisma-migrations.mjs"]'), "On-prem schema stage must use the guarded versioned migration runner.");
assert.ok(!dockerfile.includes('"db:push"'), "Production schema image must not run prisma db push.");

assert.match(migrationLock, /provider\s*=\s*"postgresql"/);
assert.ok(baselineSql.length > 50000, "Committed migration baseline is unexpectedly small.");
assert.ok(baselineSql.includes('CREATE TABLE "Tenant"'), "Baseline must contain core tenant schema.");
assert.ok(baselineSql.includes("CREATE TYPE"), "Baseline must contain enum definitions.");
assert.ok(migrationContract.includes("20261007000000_baseline_current_schema"), "Shared migration contract must pin the committed baseline name.");
assert.ok(migrationRunner.includes("BASELINE_MIGRATION"), "Migration runner must consume the shared baseline identifier.");
for (const token of [
  "public._prisma_migrations",
  "Legacy database without Prisma migration history detected",
  "--from-schema-datasource",
  "--to-schema-datamodel",
  "migrate",
  "resolve",
  "--applied",
  "migrate",
  "deploy"
]) assert.ok(migrationRunner.includes(token), `Migration runner safety contract missing: ${token}`);
assert.ok(!migrationRunner.includes("--accept-data-loss"), "Migration runner must never force destructive schema changes.");
assert.ok(!migrationRunner.includes("--from-url"), "Migration runner must not expose DATABASE_URL through CLI argv.");

for (const token of [
  "hrbp_migration_fresh",
  "hrbp_migration_legacy",
  "hrbp_migration_drift",
  "--from-migrations",
  "--shadow-database-url",
  "migration_drift_probe",
  "No baseline marker was written"
]) assert.ok(migrationVerifier.includes(token), `Migration verification contract missing: ${token}`);

for (const token of [
  'privateHttpHost = null',
  'endpoint.hostname === privateHttpHost',
  'endpoint.port === "3000"'
]) assert.ok(maintenanceRunner.includes(token), `Private maintenance transport contract missing: ${token}`);
for (const token of [
  'privateHttpHost = "app"',
  'blocked.json',
  'ambiguousStop(report)',
  'maintenance-cycle',
  'sleepWithHeartbeat'
]) assert.ok(maintenanceScheduler.includes(token), `On-prem maintenance scheduler contract missing: ${token}`);
for (const token of [
  'MIN_INTERVAL_SECONDS = 300',
  'MAX_INTERVAL_SECONDS = 86_400',
  'UNEXPECTED_RESPONSE_STOPPED',
  'BLOCKED_UNKNOWN_OUTCOME',
  'LAST_RUN_FAILED'
]) assert.ok(maintenanceState.includes(token), `Scheduler state safety contract missing: ${token}`);

for (const token of [
  "APP_URL must be a clean HTTPS origin",
  "must not reuse the same secret",
  "HRBP_OIDC_REDIRECT_URI",
  "HRBP_AUTH_TENANT_ID",
  "HRBP_MAINTENANCE_INTERVAL_SECONDS",
  "docker",
  "compose",
  "config",
  "--quiet"
]) assert.ok(preflight.includes(token), `On-prem deployment preflight contract missing: ${token}`);
for (const token of [
  "placeholder secret",
  "secret reuse",
  "non-https app url",
  "bad callback origin",
  "placeholder tenant",
  "admin outside allowlist",
  "too-fast scheduler",
  "mutable image"
]) assert.ok(preflightTest.includes(token), `On-prem preflight test coverage missing: ${token}`);

for (const key of [
  "POSTGRES_PASSWORD", "OBJECT_STORAGE_SECRET_KEY", "HRBP_SESSION_SECRET",
  "HRBP_ENGAGEMENT_RESPONSE_SECRET", "HRBP_DOCUMENT_SCAN_TOKEN",
  "HRBP_MAINTENANCE_TOKEN", "HRBP_OIDC_CLIENT_SECRET"
]) {
  assert.ok(env.includes(`${key}=CHANGE_ME`), `Example must force operator replacement for ${key}`);
}
assert.match(env, /HRBP_LOCAL_AUTH_ENABLED=false/);
assert.match(env, /HRBP_HTTP_BIND=127\.0\.0\.1/);
assert.match(env, /HRBP_MAINTENANCE_INTERVAL_SECONDS=900/);
assert.match(env, /OBJECT_STORAGE_IMAGE=chrislusf\/seaweedfs:4\.48/);
assert.match(env, /OBJECT_STORAGE_TOOL_IMAGE=rclone\/rclone:1\.75\.1/);
assert.ok(!/^(?:POSTGRES|OBJECT_STORAGE|MINIO).*IMAGE=.*:latest$/m.test(env), "On-prem images must not use mutable latest tags.");
assert.ok(!env.includes("MINIO_"), "Retired MinIO bootstrap settings must not remain in the production example.");
assert.ok(ignore.includes(".env.*"), "Docker context must exclude environment files.");
assert.ok(ignore.includes("!.env.onprem.example"), "Docker context must retain the safe example.");
assert.ok(gitignore.includes(".env.onprem"), "Real on-prem environment file must be gitignored.");
assert.ok(gitignore.includes("backups/"), "Local backup artifacts must never be committed.");
assert.ok(gitAttributes.includes("prisma/migrations/**/*.sql text eol=lf"), "Migration SQL must be byte-stable across platforms.");
assert.ok(gitAttributes.includes("scripts/*.sh text eol=lf"), "Release shell scripts must use LF line endings.");

for (const token of [
  "umask 077",
  ".incomplete",
  "pg_dump --format=custom",
  'rclone sync "hrbp:$OBJECT_STORAGE_BUCKET" /backup',
  "runtime-health.json",
  "images.json",
  "migration-history.json",
  "scheduler-status.json",
  "onprem-maintenance-control.mjs status",
  "_prisma_migrations",
  '"objectFormat": "s3-rclone-mirror"',
  "sha256sum postgres.dump",
  "migration-history.json scheduler-status.json > SHA256SUMS"
]) assert.ok(backup.includes(token), `Backup safety contract missing: ${token}`);
assert.ok(!backup.includes("--accept-data-loss"), "Backup path must never force schema changes.");
assert.ok(!backup.includes("mc "), "Backup must not depend on retired MinIO-only tooling.");
assert.ok(backup.includes('--user "$(id -u):$(id -g)"'), "Backup recovery tooling must preserve host ownership for bind-mounted artifacts.");

for (const token of [
  "--confirm-erase",
  "sha256sum -c SHA256SUMS",
  "stop maintenance-scheduler app schema",
  "up -d --wait postgres object-storage",
  "dropdb --if-exists --force",
  "createdb -U",
  "pg_restore --exit-on-error",
  'rclone sync /backup "hrbp:$OBJECT_STORAGE_BUCKET"',
  "--delete-during",
  "reserved database",
  "onprem-restore-scheduler-state.mjs",
  "scheduler-status.json:/restore/scheduler-status.json:ro",
  "application and maintenance scheduler remain stopped"
]) assert.ok(restore.includes(token), `Restore safety contract missing: ${token}`);
assert.ok(!restore.includes("db push"), "Restore must not run implicit schema mutation.");
assert.ok(!restore.includes("--accept-data-loss"), "Restore must not bypass destructive-schema protection.");
assert.ok(!restore.includes("mc "), "Restore must be S3-provider neutral.");

for (const token of [
  "HRBP_DISPOSABLE_RECOVERY_REHEARSAL",
  "hrbp-recovery-",
  'POSTGRES_DB="hrbp_recovery"',
  "up -d --wait postgres object-storage",
  "original-db",
  "mutated-db",
  "should_disappear",
  "original-object",
  "recovery-extra.txt",
  "rclone rcat",
  "rclone cat",
  "--confirm-erase"
]) assert.ok(rehearsal.includes(token), `Recovery rehearsal contract missing: ${token}`);

const pkg = JSON.parse(packageJson);
const lock = JSON.parse(packageLock);
assert.equal(lock.lockfileVersion, 3, "Committed npm lockfile must use lockfileVersion 3.");
assert.equal(lock.packages?.[""]?.name, pkg.name, "Lockfile root package must match package.json.");
assert.equal(
  pkg.scripts?.["onprem:recovery:rehearsal"],
  "HRBP_DISPOSABLE_RECOVERY_REHEARSAL=true bash scripts/onprem-recovery-rehearsal.sh",
  "Recovery rehearsal must be available as an explicit operator/CI command."
);
assert.equal(pkg.scripts?.["db:migrate:deploy"], "prisma migrate deploy --schema=prisma");
assert.equal(pkg.scripts?.["db:migrate:upgrade"], "node scripts/deploy-prisma-migrations.mjs");
assert.equal(pkg.scripts?.["db:migrate:verify"], "node scripts/verify-prisma-migrations.mjs");
assert.ok(pkg.scripts?.["onprem:validate"]?.includes("onprem-maintenance-scheduler.test.mjs"), "On-prem validation must execute scheduler safety tests.");
assert.equal(pkg.scripts?.["onprem:preflight"], "node scripts/onprem-preflight.mjs");
assert.ok(pkg.scripts?.["onprem:validate"]?.includes("onprem-preflight.test.mjs"), "On-prem validation must execute deployment preflight tests.");

for (const token of [
  "scripts/onprem-backup.sh",
  "scripts/onprem-restore.sh",
  "recovery rehearsal",
  "application and maintenance scheduler remain stopped",
  "SeaweedFS",
  "rclone",
  "Versioned migrations",
  "migrate deploy",
  "baseline adoption",
  "maintenance-scheduler",
  "blocked.json",
  "--acknowledge-unknown",
  "npm run onprem:preflight"
]) assert.ok(docs.includes(token), `On-prem runbook missing recovery guidance: ${token}`);

console.log("On-prem package, recovery and versioned migration safety validation passed.");
