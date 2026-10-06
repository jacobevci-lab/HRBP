import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  compose,
  dockerfile,
  env,
  ignore,
  gitignore,
  backup,
  restore,
  rehearsal,
  docs,
  packageJson
] = await Promise.all([
  readFile("docker-compose.onprem.yml", "utf8"),
  readFile("Dockerfile.onprem", "utf8"),
  readFile(".env.onprem.example", "utf8"),
  readFile(".dockerignore", "utf8"),
  readFile(".gitignore", "utf8"),
  readFile("scripts/onprem-backup.sh", "utf8"),
  readFile("scripts/onprem-restore.sh", "utf8"),
  readFile("scripts/onprem-recovery-rehearsal.sh", "utf8"),
  readFile("docs/ONPREM-DEPLOYMENT.md", "utf8"),
  readFile("package.json", "utf8")
]);

const required = [
  "postgres:", "minio:", "minio-init:", "schema:", "app:",
  "service_completed_successfully", "service_healthy",
  "HRBP_ALLOW_INSECURE_CONTEXT_HEADERS: \"false\"",
  "/api/health/runtime", "target: runtime", "target: schema"
];
for (const token of required) assert.ok(compose.includes(token), `Missing on-prem compose contract: ${token}`);

const postgresBlock = (compose.split("\n  postgres:\n")[1] ?? "").split("\n  minio:\n")[0];
const minioBlock = (compose.split("\n  minio:\n")[1] ?? "").split("\n  minio-init:\n")[0];
assert.ok(postgresBlock, "PostgreSQL service block must be present.");
assert.ok(minioBlock, "MinIO service block must be present.");
assert.ok(!/\n\s+ports:/.test(postgresBlock), "PostgreSQL must not publish a host port.");
assert.ok(!/\n\s+ports:/.test(minioBlock), "MinIO must not publish a host port.");
assert.ok(!compose.includes("--accept-data-loss"), "Schema bootstrap must never accept destructive changes automatically.");
assert.ok(compose.includes("POSTGRES_PASSWORD:?set POSTGRES_PASSWORD"));
assert.ok(compose.includes("MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD"));
assert.ok(compose.includes("OBJECT_STORAGE_ACCESS_KEY:?set OBJECT_STORAGE_ACCESS_KEY"));
assert.ok(compose.includes("OBJECT_STORAGE_SECRET_KEY:?set OBJECT_STORAGE_SECRET_KEY"));
assert.ok(compose.includes("mc admin policy create hrbp hrbp-app"));
assert.ok(compose.includes("mc admin user add hrbp"));
assert.ok(compose.includes("mc admin policy attach hrbp hrbp-app --user"));
assert.ok(compose.includes('"s3:GetObject","s3:PutObject"'));
assert.ok(!compose.includes("OBJECT_STORAGE_ACCESS_KEY: ${MINIO_ROOT_USER}"), "Application must not use MinIO root access key.");
assert.ok(!compose.includes("OBJECT_STORAGE_SECRET_KEY: ${MINIO_ROOT_PASSWORD}"), "Application must not use MinIO root secret.");
assert.ok(compose.includes("APP_URL:?set APP_URL"));

assert.match(dockerfile, /npm prune --omit=dev/);
assert.ok(dockerfile.includes("COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma"), "Generated Prisma client must be restored after production pruning.");
assert.match(dockerfile, /USER node/);
assert.match(dockerfile, /HEALTHCHECK[\s\S]*api\/health\/runtime/);
assert.match(dockerfile, /FROM builder AS schema/);
assert.ok(compose.includes("until mc ready hrbp"), "MinIO initialization must wait using the MinIO client rather than assuming curl exists in the server image.");
assert.ok(compose.includes("no-new-privileges:true") && compose.includes("cap_drop:"), "Application container must drop ambient Linux privileges.");
assert.ok(!dockerfile.includes("--accept-data-loss"));

for (const key of [
  "POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "OBJECT_STORAGE_SECRET_KEY", "HRBP_SESSION_SECRET",
  "HRBP_ENGAGEMENT_RESPONSE_SECRET", "HRBP_DOCUMENT_SCAN_TOKEN",
  "HRBP_MAINTENANCE_TOKEN", "HRBP_OIDC_CLIENT_SECRET"
]) {
  assert.ok(env.includes(`${key}=CHANGE_ME`), `Example must force operator replacement for ${key}`);
}
assert.match(env, /HRBP_LOCAL_AUTH_ENABLED=false/);
assert.match(env, /HRBP_HTTP_BIND=127\.0\.0\.1/);
assert.ok(ignore.includes(".env.*"), "Docker context must exclude environment files.");
assert.ok(ignore.includes("!.env.onprem.example"), "Docker context must retain the safe example.");
assert.ok(gitignore.includes(".env.onprem"), "Real on-prem environment file must be gitignored.");
assert.ok(gitignore.includes("backups/"), "Local backup artifacts must never be committed.");

for (const token of [
  "umask 077",
  ".incomplete",
  "pg_dump --format=custom",
  "mc mirror --overwrite",
  "runtime-health.json",
  "images.json",
  "sha256sum postgres.dump"
]) assert.ok(backup.includes(token), `Backup safety contract missing: ${token}`);
assert.ok(!backup.includes("--accept-data-loss"), "Backup path must never force schema changes.");

for (const token of [
  "--confirm-erase",
  "sha256sum -c SHA256SUMS",
  "stop app schema",
  "dropdb --if-exists --force",
  "createdb -U",
  "pg_restore --exit-on-error",
  "mc mirror --overwrite --remove",
  "reserved database",
  "application remains stopped"
]) assert.ok(restore.includes(token), `Restore safety contract missing: ${token}`);
assert.ok(!restore.includes("db push"), "Restore must not run implicit schema mutation.");
assert.ok(!restore.includes("--accept-data-loss"), "Restore must not bypass destructive-schema protection.");

for (const token of [
  "HRBP_DISPOSABLE_RECOVERY_REHEARSAL",
  "hrbp-recovery-",
  "POSTGRES_DB=\"hrbp_recovery\"",
  "original-db",
  "mutated-db",
  "should_disappear",
  "original-object",
  "recovery-extra.txt",
  "--confirm-erase"
]) assert.ok(rehearsal.includes(token), `Recovery rehearsal contract missing: ${token}`);

const pkg = JSON.parse(packageJson);
assert.equal(
  pkg.scripts?.["onprem:recovery:rehearsal"],
  "HRBP_DISPOSABLE_RECOVERY_REHEARSAL=true bash scripts/onprem-recovery-rehearsal.sh",
  "Recovery rehearsal must be available as an explicit operator/CI command."
);

for (const token of [
  "scripts/onprem-backup.sh",
  "scripts/onprem-restore.sh",
  "recovery rehearsal",
  "application remains stopped",
  "Versioned migrations"
]) assert.ok(docs.includes(token), `On-prem runbook missing recovery guidance: ${token}`);

console.log("On-prem package and recovery safety validation passed.");
