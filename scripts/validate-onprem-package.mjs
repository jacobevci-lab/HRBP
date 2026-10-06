import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [compose, dockerfile, env, ignore, gitignore] = await Promise.all([
  readFile("docker-compose.onprem.yml", "utf8"),
  readFile("Dockerfile.onprem", "utf8"),
  readFile(".env.onprem.example", "utf8"),
  readFile(".dockerignore", "utf8"),
  readFile(".gitignore", "utf8")
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

console.log("On-prem package validation passed.");
