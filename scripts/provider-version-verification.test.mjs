import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizedProviderVersionId, runtimeHealth } from "../lib/runtime-health.mjs";
import { deploymentConfig, deploymentSummary, verifyDeployment } from "./verify-deployment.mjs";

const SHA = "a".repeat(40);
const PROBE = "c".repeat(32);
const VERSION = "11111111-2222-4333-8444-555555555555";
const OTHER_VERSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function providerHealth(versionId = VERSION) {
  const base = runtimeHealth(SHA, PROBE);
  return { ...base, release: { ...base.release, providerVersionId: versionId } };
}
function reply(body) {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
const strict = {
  origin: "https://hrbp.example",
  expectedRevision: SHA,
  expectedProviderVersionId: VERSION,
  requireProviderVersion: true,
  nonce: () => PROBE
};

test("provider Version IDs are accepted only as canonical UUID-shaped values", () => {
  assert.equal(normalizedProviderVersionId(VERSION.toUpperCase()), VERSION);
  for (const value of [null, undefined, "", "latest", "12345678", VERSION + "\n", "token-secret-value", 123]) {
    assert.equal(normalizedProviderVersionId(value), null);
  }
});

test("strict provider verification fails configuration before network access when Version ID is absent or malformed", async () => {
  let calls = 0;
  for (const extra of [
    { expectedProviderVersionId: null },
    { expectedProviderVersionId: "" },
    { expectedProviderVersionId: "latest" },
    { expectedProviderVersionId: VERSION + "\n" },
    { requireProviderVersion: "true" }
  ]) {
    await assert.rejects(verifyDeployment({ ...strict, ...extra, fetchImpl: async () => { calls++; return reply(providerHealth()); } }));
  }
  assert.equal(calls, 0);
});

test("strict verification requires the fresh runtime revision and Cloudflare Version ID to match together", async () => {
  const report = await verifyDeployment({ ...strict, fetchImpl: async () => reply(providerHealth()) });
  assert.equal(report.success, true);
  assert.equal(report.code, "REVISION_AND_PROVIDER_VERSION_MATCH");
  assert.equal(report.expectedProviderVersionId, VERSION);
  assert.equal(report.observedProviderVersionId, VERSION);
});

test("missing, malformed or different runtime Version IDs never become deployment success", async () => {
  for (const [body, code] of [
    [runtimeHealth(SHA, PROBE), "PROVIDER_VERSION_UNIDENTIFIED"],
    [providerHealth("private-token-value"), "PROVIDER_VERSION_UNIDENTIFIED"],
    [providerHealth(OTHER_VERSION), "PROVIDER_VERSION_MISMATCH"]
  ]) {
    const report = await verifyDeployment({ ...strict, fetchImpl: async () => reply(body) });
    assert.equal(report.success, false);
    assert.equal(report.code, code);
    assert.ok(!JSON.stringify(report).includes("private-token-value"));
  }
});

test("legacy revision-only callers remain compatible and cannot be mistaken for strict provider acceptance", async () => {
  const report = await verifyDeployment({
    origin: strict.origin, expectedRevision: SHA, nonce: strict.nonce,
    fetchImpl: async () => reply(runtimeHealth(SHA, PROBE))
  });
  assert.equal(report.success, true);
  assert.equal(report.code, "REVISION_MATCH");
  assert.equal(report.expectedProviderVersionId, null);
  assert.equal(report.observedProviderVersionId, null);
});

test("summary exposes only allowlisted revision/version identifiers and the reduced assurance scope", async () => {
  const report = await verifyDeployment({ ...strict, fetchImpl: async () => reply(providerHealth()) });
  const summary = deploymentSummary(report);
  assert.match(summary, /REVISION_AND_PROVIDER_VERSION_MATCH/);
  assert.match(summary, new RegExp(VERSION));
  assert.match(summary, /provider build logs.*NOT verified/i);
  assert.ok(!summary.includes(strict.origin));
});

test("Cloudflare Version Metadata is configured but local Worker smoke deliberately does not impersonate it", () => {
  const wrangler = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  assert.deepEqual(wrangler.version_metadata, { binding: "CF_VERSION_METADATA" });

  const route = readFileSync("app/api/health/runtime/route.ts", "utf8");
  assert.match(route, /getCloudflareContext/);
  assert.match(route, /CF_VERSION_METADATA/);
  assert.match(route, /normalizedProviderVersionId\(env\.CF_VERSION_METADATA\?\.id\)/);
  assert.doesNotMatch(route, /CF_VERSION_METADATA\?\.(?:tag|timestamp)|\.CF_VERSION_METADATA\.(?:tag|timestamp)/);
  assert.match(route, /catch\s*\{\s*return null;/);

  const smoke = readFileSync("scripts/stacked-worker-smoke.mjs", "utf8");
  assert.match(smoke, /never provider IDs/);
  assert.doesNotMatch(smoke, /version_metadata\s*:/);
});

test("manual Release Verification requires an independently supplied provider Version ID", () => {
  const workflow = readFileSync(".github/workflows/release-verification.yml", "utf8");
  assert.match(workflow, /expected_provider_version_id:\n\s+description:/);
  assert.match(workflow, /expected_provider_version_id:[\s\S]{0,180}required: true/);
  assert.match(workflow, /HRBP_EXPECTED_PROVIDER_VERSION_ID: \$\{\{ inputs\.expected_provider_version_id \}\}/);
  assert.match(workflow, /HRBP_REQUIRE_PROVIDER_VERSION: "true"/);
  assert.match(workflow, /run: npm run deployment-verification:validate/);
  assert.match(workflow, /run: node scripts\/verify-deployment\.mjs/);
});

test("production prebuild keeps provider-version verification mandatory", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["deployment-verification:validate"],
    "node --test scripts/deployment-verification.test.mjs scripts/provider-version-verification.test.mjs");
  assert.ok(pkg.scripts.prebuild.split(" && ").includes("npm run deployment-verification:validate"));
});

test("strict deployment configuration normalizes the operator-supplied Version ID without widening origin rules", () => {
  const config = deploymentConfig({ ...strict, expectedProviderVersionId: VERSION.toUpperCase() });
  assert.equal(config.expectedProviderVersionId, VERSION);
  assert.equal(config.requireProviderVersion, true);
  assert.equal(config.origin, "https://hrbp.example");
});
