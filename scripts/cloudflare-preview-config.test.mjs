import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wrangler = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Cloudflare Worker Previews are explicitly enabled and production bindings are not inherited", () => {
  assert.equal(wrangler.preview_urls, true);
  assert.equal(wrangler.workers_dev, true);
  assert.ok(wrangler.previews && typeof wrangler.previews === "object");
  assert.equal(wrangler.previews.vars?.HRBP_LOCAL_AUTH_ENABLED, "false");
  assert.equal(wrangler.previews.vars?.HRBP_AUTH_TENANT_ID, "tenant-acme-global");
  assert.equal(wrangler.previews.hyperdrive, undefined, "Preview must not silently reuse production Hyperdrive.");
  assert.equal(wrangler.previews.version_metadata?.binding, "CF_VERSION_METADATA");
  assert.ok(Array.isArray(wrangler.hyperdrive) && wrangler.hyperdrive.length === 1, "Production Hyperdrive remains top-level only.");
});

test("repository exposes a branch Preview deployment command without production deploy semantics", () => {
  const command = pkg.scripts?.["cf:preview:deploy"];
  assert.equal(typeof command, "string");
  assert.match(command, /opennextjs-cloudflare build/);
  assert.match(command, /wrangler preview(?:\s|$)/);
  assert.doesNotMatch(command, /wrangler deploy|opennextjs-cloudflare deploy/);
});

test("pinned Wrangler supports Worker Previews", () => {
  const match = String(pkg.devDependencies?.wrangler ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, "Wrangler must have an explicit version.");
  const [major, minor] = match.slice(1, 3).map(Number);
  assert.ok(major > 4 || (major === 4 && minor >= 135), "Worker Previews require Wrangler 4.135.0 or newer.");
});


test("Cloudflare build uses a loopback-only fallback and never requires a production database secret", () => {
  const build = readFileSync("scripts/cloudflare-build.mjs", "utf8");
  assert.equal(pkg.scripts?.["cf:build"], "node scripts/cloudflare-build.mjs");
  assert.match(build, /process\.env\.DATABASE_URL \|\| "postgresql:\/\/build:build@127\.0\.0\.1:5432\/hrbp_build"/);
  assert.match(build, /npm_config_ignore_scripts: "true"/);
  assert.match(build, /run\(npm, \["run", "typecheck"\]\)/);
  assert.match(build, /run\(openNext, \["build"\]\)/);
  assert.doesNotMatch(build, /fornostsecurity|neon\.tech|amazonaws\.com|supabase\.co/i);
  const fallback = build.match(/DATABASE_URL: process\.env\.DATABASE_URL \|\| "([^"]+)"/)?.[1];
  assert.equal(fallback, "postgresql://build:build@127.0.0.1:5432/hrbp_build");
});
