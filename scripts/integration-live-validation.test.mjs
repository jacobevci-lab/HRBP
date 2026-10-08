import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationProbeTarget,
  integrationValidationCurrent,
  INTEGRATION_VALIDATION_MAX_AGE_MS,
  parseIntegrationProbeOrigins,
  probeIntegrationEndpoint
} from "../lib/integration-live-validation.mjs";

test("probe origin policy accepts only explicit normalized origins", () => {
  assert.deepEqual(
    parseIntegrationProbeOrigins("https://API.EXAMPLE.COM/,https://10.20.30.40"),
    ["https://api.example.com", "https://10.20.30.40"]
  );
  assert.equal(parseIntegrationProbeOrigins("http://api.example.com"), null);
  assert.deepEqual(
    parseIntegrationProbeOrigins("http://api.example.com", true),
    ["http://api.example.com"]
  );
  assert.equal(parseIntegrationProbeOrigins("https://api.example.com/path"), null);
  assert.equal(parseIntegrationProbeOrigins("https://user:pass@api.example.com"), null);
  assert.equal(parseIntegrationProbeOrigins("https://api.example.com,https://api.example.com"), null);
  assert.equal(parseIntegrationProbeOrigins("https://127.0.0.1"), null);
  assert.equal(parseIntegrationProbeOrigins("https://169.254.169.254"), null);
  assert.equal(parseIntegrationProbeOrigins("https://[::1]"), null);
});

test("live validation evidence expires after a bounded activation window", () => {
  const now = Date.parse("2026-10-08T08:00:00.000Z");
  assert.equal(integrationValidationCurrent(new Date(now), now), true);
  assert.equal(integrationValidationCurrent(new Date(now - INTEGRATION_VALIDATION_MAX_AGE_MS), now), true);
  assert.equal(integrationValidationCurrent(new Date(now - INTEGRATION_VALIDATION_MAX_AGE_MS - 1), now), false);
  assert.equal(integrationValidationCurrent(new Date(now + 60_001), now), false);
  assert.equal(integrationValidationCurrent(null, now), false);
});

test("probe target must remain on an approved exact origin", () => {
  const allowed = ["https://api.example.com"];
  assert.equal(
    integrationProbeTarget("https://api.example.com/v1/health?tenant=bounded", allowed)?.origin,
    "https://api.example.com"
  );
  assert.equal(integrationProbeTarget("https://other.example.com/v1", allowed), null);
  assert.equal(integrationProbeTarget("http://api.example.com/v1", allowed), null);
  assert.equal(integrationProbeTarget("https://user:pass@api.example.com/v1", allowed), null);
});

test("live validation performs a bounded HEAD without following redirects", async () => {
  let seen = null;
  const result = await probeIntegrationEndpoint({
    baseUrl: "https://api.example.com/v1",
    allowedOrigins: ["https://api.example.com"],
    timeoutMs: 2500,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(null, { status: 401 });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 401);
  assert.equal(result.origin, "https://api.example.com");
  assert.equal(seen.url, "https://api.example.com/v1");
  assert.equal(seen.init.method, "HEAD");
  assert.equal(seen.init.redirect, "manual");
  assert.equal(seen.init.cache, "no-store");
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test("blocked and unavailable transports fail closed without response bodies", async () => {
  const blocked = await probeIntegrationEndpoint({
    baseUrl: "https://other.example.com",
    allowedOrigins: ["https://api.example.com"],
    fetchImpl: async () => { throw new Error("must not execute"); }
  });
  assert.deepEqual(blocked, { ok: false, reason: "TARGET_NOT_ALLOWED" });

  const unavailable = await probeIntegrationEndpoint({
    baseUrl: "https://api.example.com",
    allowedOrigins: ["https://api.example.com"],
    fetchImpl: async () => { throw new Error("secret provider text that must not escape"); }
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, "TRANSPORT_UNAVAILABLE");
  assert.equal(unavailable.origin, "https://api.example.com");
  assert.ok(!JSON.stringify(unavailable).includes("secret provider text"));
});
