import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runtimeHealth } from "../lib/runtime-health.mjs";

const read = path => readFileSync(path, "utf8");

test("on-prem Docker build is standalone and non-root", () => {
  const source = read("Dockerfile.onprem");
  assert.match(source, /HRBP_BUILD_TARGET=onprem/);
  assert.match(source, /FROM builder AS schema/);
  assert.match(source, /FROM base AS runtime/);
  assert.match(source, /USER hrbp/);
  assert.match(source, /CMD \["node", "server\.js"\]/);
});

test("Next standalone output is isolated from default Cloudflare build", () => {
  const source = read("next.config.ts");
  assert.match(source, /HRBP_BUILD_TARGET === "onprem"/);
  assert.match(source, /output: "standalone"/);
  assert.match(source, /if \(!onPremBuild\) initOpenNextCloudflareForDev/);
});

test("compose keeps data services private and hardens app runtime", () => {
  const source = read("deploy/onprem/compose.yml");
  assert.match(source, /backend:\n\s+internal: true/);
  assert.match(source, /DATABASE_URL: postgresql:\/\/hrbp_app:/);
  assert.match(source, /read_only: true/);
  assert.match(source, /cap_drop: \["ALL"\]/);
  assert.match(source, /no-new-privileges:true/);
  const postgres = source.slice(source.indexOf("  postgres:"), source.indexOf("  redis:"));
  const redis = source.slice(source.indexOf("  redis:"), source.indexOf("  minio:"));
  const minio = source.slice(source.indexOf("  minio:"), source.indexOf("  schema-bootstrap:"));
  assert.doesNotMatch(postgres, /\n\s+ports:/);
  assert.doesNotMatch(redis, /\n\s+ports:/);
  assert.doesNotMatch(minio, /\n\s+ports:/);
});

test("schema bootstrap is install-only and refuses a populated database", () => {
  const source = read("scripts/onprem-schema-bootstrap.mjs");
  const guard = source.indexOf("target database is not empty");
  const push = source.indexOf('"db:push"');
  assert.ok(guard > 0 && push > guard);
  assert.match(source, /prisma\.tenant\.create/);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.doesNotMatch(source, /accept-data-loss/);
});

test("runtime health identifies on-prem without changing Cloudflare default", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  assert.equal(runtimeHealth("a".repeat(40), null, now).runtime, "cloudflare-workers");
  assert.equal(runtimeHealth("a".repeat(40), null, now, "onprem-node").runtime, "onprem-node");
  assert.equal(runtimeHealth("a".repeat(40), null, now, "other").runtime, "cloudflare-workers");
});

test("example deployment separates admin and runtime database identities", () => {
  const env = read("deploy/onprem/.env.example");
  assert.match(env, /POSTGRES_USER=hrbp_admin/);
  assert.match(env, /HRBP_DB_APP_PASSWORD=/);
  const init = read("deploy/onprem/postgres-init.sh");
  assert.match(init, /CREATE ROLE hrbp_app/);
  assert.match(init, /NOSUPERUSER/);
});

test("Docker context excludes local secrets and build output", () => {
  const source = read(".dockerignore");
  for (const item of [".git", "node_modules", ".env", "deploy/onprem/.env", ".next"]) assert.ok(source.includes(item));
});
