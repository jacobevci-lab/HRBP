import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(os.tmpdir(), "hrbp-onprem-preflight-"));
const envPath = path.join(dir, ".env.onprem");

const valid = {
  APP_URL: "https://hrbp.customer.test",
  HRBP_HTTP_BIND: "127.0.0.1",
  HRBP_HTTP_PORT: "3000",
  POSTGRES_USER: "hrbp",
  POSTGRES_DB: "hrbp",
  POSTGRES_PASSWORD: "p".repeat(40),
  OBJECT_STORAGE_ACCESS_KEY: "hrbp-app",
  OBJECT_STORAGE_SECRET_KEY: "o".repeat(40),
  OBJECT_STORAGE_BUCKET: "hrbp-private",
  OBJECT_STORAGE_REGION: "us-east-1",
  HRBP_SESSION_SECRET: "s".repeat(72),
  HRBP_ENGAGEMENT_RESPONSE_SECRET: "e".repeat(72),
  HRBP_DOCUMENT_SCAN_TOKEN: "d".repeat(40),
  HRBP_MAINTENANCE_TOKEN: "m".repeat(40),
  HRBP_MAINTENANCE_INTERVAL_SECONDS: "900",
  HRBP_LOCAL_AUTH_ENABLED: "false",
  HRBP_OIDC_ISSUER: "https://login.customer.test/tenant/v2.0",
  HRBP_OIDC_CLIENT_ID: "customer-client-id",
  HRBP_OIDC_CLIENT_SECRET: "oidc-client-secret-not-placeholder",
  HRBP_OIDC_SCOPES: "openid profile email",
  HRBP_OIDC_REDIRECT_URI: "https://hrbp.customer.test/api/auth/callback",
  HRBP_AUTH_TENANT_ID: "customer-prod-01",
  HRBP_BOOTSTRAP_ADMIN_EMAIL: "admin@customer.test",
  HRBP_ALLOWED_EMAIL_DOMAINS: "customer.test",
  HRBP_OIDC_JIT_PROVISIONING: "false",
  POSTGRES_IMAGE: "postgres:17-alpine",
  OBJECT_STORAGE_IMAGE: "chrislusf/seaweedfs:4.48",
  OBJECT_STORAGE_TOOL_IMAGE: "rclone/rclone:1.75.1"
};

function serialize(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

async function run(values) {
  await writeFile(envPath, serialize(values), { mode: 0o600 });
  const result = spawnSync(process.execPath, ["scripts/onprem-preflight.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, HRBP_ENV_FILE: envPath, HRBP_COMPOSE_FILE: "docker-compose.onprem.yml", HRBP_PREFLIGHT_SKIP_DOCKER: "true" },
    encoding: "utf8"
  });
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* assertion below will show stdout/stderr */ }
  return { ...result, report };
}

try {
  const good = await run(valid);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(good.report?.ok, true);
  assert.ok(good.report?.warnings.some((message) => /Docker Compose validation was explicitly skipped/.test(message)));

  for (const [name, mutate, expected] of [
    ["placeholder secret", (env) => { env.POSTGRES_PASSWORD = "CHANGE_ME_32_PLUS_RANDOM_CHARS"; }, /POSTGRES_PASSWORD/],
    ["secret reuse", (env) => { env.HRBP_MAINTENANCE_TOKEN = env.OBJECT_STORAGE_SECRET_KEY; }, /must not reuse/],
    ["non-https app url", (env) => { env.APP_URL = "http://hrbp.customer.test"; }, /APP_URL/],
    ["bad callback origin", (env) => { env.HRBP_OIDC_REDIRECT_URI = "https://other.customer.test/api/auth/callback"; }, /REDIRECT_URI/],
    ["placeholder tenant", (env) => { env.HRBP_AUTH_TENANT_ID = "customer-production"; }, /TENANT_ID/],
    ["admin outside allowlist", (env) => { env.HRBP_BOOTSTRAP_ADMIN_EMAIL = "admin@other.test"; }, /ALLOWED_EMAIL_DOMAINS/],
    ["too-fast scheduler", (env) => { env.HRBP_MAINTENANCE_INTERVAL_SECONDS = "60"; }, /MAINTENANCE_INTERVAL/],
    ["mutable image", (env) => { env.POSTGRES_IMAGE = "postgres:latest"; }, /POSTGRES_IMAGE/]
  ]) {
    const candidate = { ...valid };
    mutate(candidate);
    const result = await run(candidate);
    assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
    assert.ok(result.report?.errors.some((message) => expected.test(message)), `${name}: ${result.stdout} ${result.stderr}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("On-prem deployment preflight validation tests passed.");
