import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedJsonParse,
  diagnosticsContainSecretMaterial,
  sanitizeAuthHealth,
  sanitizeComposeService,
  sanitizeDatabaseHealth,
  sanitizeRuntimeHealth,
  sanitizeSchedulerStatus
} from "./onprem-support-bundle-lib.mjs";

test("database health sanitizer drops free-form detail while keeping bounded diagnostics", () => {
  const secret = "postgresql://user:password@db.internal/hrbp";
  const result = sanitizeDatabaseHealth({
    status: "unavailable",
    database: "postgresql",
    transport: "direct",
    orm: "prisma",
    reason: "network",
    errorName: "PrismaClientError",
    errorCode: "P1001",
    latencyMs: 42.4,
    detail: `connection failed ${secret}`
  });
  assert.deepEqual(result, {
    status: "unavailable",
    database: "postgresql",
    transport: "direct",
    orm: "prisma",
    reason: "network",
    errorName: "PrismaClientError",
    errorCode: "P1001",
    latencyMs: 42
  });
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("auth sanitizer reports counts, not missing secret/configuration names", () => {
  const result = sanitizeAuthHealth({
    status: "configuration_required",
    authentication: "oidc",
    configured: false,
    missing: ["HRBP_OIDC_CLIENT_SECRET", "HRBP_SESSION_SECRET"],
    modes: [{
      mode: "oidc",
      enabled: true,
      configured: false,
      missing: ["HRBP_OIDC_CLIENT_SECRET"]
    }]
  });
  assert.equal(result.missingCount, 2);
  assert.equal(result.modes[0].missingCount, 1);
  assert.ok(!JSON.stringify(result).includes("HRBP_OIDC_CLIENT_SECRET"));
});

test("runtime sanitizer accepts only canonical revision identity", () => {
  assert.deepEqual(
    sanitizeRuntimeHealth({ ok: true, service: "hrbp", release: { protocolVersion: 1, revision: "a".repeat(40) }, extra: "private" }),
    { ok: true, service: "hrbp", releaseProtocolVersion: 1, releaseRevision: "a".repeat(40) }
  );
  assert.equal(sanitizeRuntimeHealth({ release: { revision: "unknown" } }).releaseRevision, null);
});

test("compose sanitizer keeps only service state image and exit code", () => {
  const result = sanitizeComposeService({
    Service: "app",
    State: "running",
    Health: "healthy",
    Image: "hrbp-one:release",
    ExitCode: 0,
    Labels: "secret-label",
    Mounts: "/customer/private/path",
    Publishers: [{ URL: "10.0.0.1" }]
  });
  assert.deepEqual(result, {
    service: "app",
    state: "running",
    health: "healthy",
    image: "hrbp-one:release",
    exitCode: 0
  });
});

test("scheduler sanitizer preserves bounded operational evidence only", () => {
  const secret = "employee-record-private-content";
  const result = sanitizeSchedulerStatus({
    blocked: { at: "2026-10-07T00:00:00Z", job: "audit-integrity", code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY", reason: secret },
    heartbeat: { at: "2026-10-07T00:01:00Z", status: "blocked", intervalSeconds: 900, pid: 1234 },
    lastRun: {
      completedAt: "2026-10-07T00:00:30Z",
      success: false,
      stopped: true,
      requested: 11,
      results: [{ job: "audit-integrity", status: "failed", httpStatus: 500, durationMs: 12, code: "JOB_FAILED", raw: secret }]
    }
  });
  assert.equal(result.blocked.code, "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY");
  assert.equal(result.lastRun.results[0].code, "JOB_FAILED");
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes("pid"));
});

test("bounded JSON parsing rejects oversized captures", () => {
  assert.deepEqual(boundedJsonParse('{"ok":true}'), { ok: true });
  assert.throws(() => boundedJsonParse(JSON.stringify({ value: "x".repeat(100) }), 32), /bounded response size/);
});

test("final redaction guard detects credentials and database URLs", () => {
  assert.equal(diagnosticsContainSecretMaterial({ ok: true, service: "hrbp" }), false);
  assert.equal(diagnosticsContainSecretMaterial({ value: "postgresql://user:pass@db/hrbp" }), true);
  assert.equal(diagnosticsContainSecretMaterial({ Authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" }), true);
  assert.equal(diagnosticsContainSecretMaterial({ password: "secret-value" }), true);
});
