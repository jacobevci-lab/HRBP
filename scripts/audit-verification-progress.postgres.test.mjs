import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { selectAuditIntegrityBatch } from "../lib/audit-integrity-batching.mjs";
import { assertAuditIntegrityRun } from "../lib/audit-integrity-outcome.mjs";

const require = createRequire(import.meta.url);

function loadMonitor(mocks) {
  const path = "lib/audit-monitoring.ts";
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error("Unexpected dependency: " + name);
    return require(name);
  });
  return module.exports.monitorAuditIntegrity;
}

test("audit verification coverage persists in disposable PostgreSQL and preserves good watermarks on errors", {
  skip: process.env.CI !== "true" || process.env.HRBP_DISPOSABLE_AUDIT_LEDGER_TEST !== "true",
  timeout: 60_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp", "This regression can run only on the disposable CI database.");

  const db = new PrismaClient();
  const tenantId = "ci-audit-progress-" + randomUUID();
  const at = new Date("2026-10-14T13:00:00Z");
  let record = { valid: true, scope: "GENESIS", checked: 7,
    verifiedThroughSequence: "7", brokenEventId: null, reason: null };
  let failNotification = false;
  let alertCalls = 0;
  try {
    await db.tenant.create({ data: { id: tenantId, name: "Synthetic audit coverage CI", region: "test" } });
    const scopedDb = {
      tenant: {
        count: async () => 1,
        findMany: async () => [{ id: tenantId }]
      },
      $executeRaw: (strings, ...values) => db.$executeRaw(strings, ...values),
      auditVerificationProgress: {
        count: args => db.auditVerificationProgress.count({
          where: { tenantId, ...args.where }
        })
      },
      $transaction: fn => db.$transaction(fn)
    };
    const mocks = {
      "@/lib/db": { db: scopedDb },
      "@/lib/audit-integrity": { verifyAuditIntegrity: async () => record },
      "@/lib/audit-integrity-batching.mjs": { selectAuditIntegrityBatch },
      "@/lib/audit-integrity-outcome.mjs": { assertAuditIntegrityRun },
      "@/lib/notification-outbox": {
        enqueueNotificationOutbox: async () => {
          alertCalls++;
          if (failNotification) throw new Error("SIMULATED_OUTBOX_FAILURE");
          return { status: "PENDING" };
        }
      },
      "@/lib/runtime-env": {
        runtimeNumber: (_name, fallback) => fallback
      }
    };
    const monitor = loadMonitor(mocks);
    const receipt = () => db.auditVerificationProgress.findUnique({ where: { tenantId } });

    const first = await monitor(at);
    assert.equal(first.verifiedWithin24h, 1);
    assert.equal(first.staleOrUnverified24h, 0);
    const initial = await receipt();
    assert.equal(initial.lastResult, "VALID");
    assert.equal(initial.lastVerifiedSequence, 7n);
    assert.equal(initial.lastVerifiedScope, "GENESIS");
    assert.equal(initial.checkedEvents, 7);
    assert.equal(initial.consecutiveFailures, 0);

    record = { valid: false, scope: "TAIL", checked: 1, brokenEventId: "synthetic-broken",
      verifiedThroughSequence: null, reason: "hash mismatch" };
    await assert.rejects(monitor(new Date(at.getTime() + 60_000)),
      error => error.code === "AUDIT_INTEGRITY_FAILURE");
    const invalid = await receipt();
    assert.equal(invalid.lastResult, "INVALID");
    assert.equal(invalid.consecutiveFailures, 1);
    assert.equal(invalid.lastVerifiedSequence, 7n);
    assert.equal(invalid.lastSuccessAt.getTime(), initial.lastSuccessAt.getTime());
    assert.equal(alertCalls, 1);

    failNotification = true;
    await assert.rejects(monitor(new Date(at.getTime() + 120_000)), /SIMULATED_OUTBOX_FAILURE/);
    assert.deepEqual(await receipt(), invalid,
      "the failure receipt and privileged alert must be in one atomic transaction");

    record = { valid: true, scope: "TAIL", checked: 3,
      verifiedThroughSequence: "8", brokenEventId: null, reason: null };
    failNotification = false;
    const final = await monitor(new Date(at.getTime() + 180_000));
    assert.equal(final.verified, 1);
    const restored = await receipt();
    assert.equal(restored.lastResult, "VALID");
    assert.equal(restored.lastVerifiedScope, "TAIL");
    assert.equal(restored.lastVerifiedSequence, 8n);
    assert.equal(restored.consecutiveFailures, 0);

    // Even a larger head from an older invocation must not move attempt time
    // backward; a later invocation must not regress the known-good sequence.
    record = { ...record, verifiedThroughSequence: "9" };
    await assert.rejects(monitor(new Date(at.getTime() + 120_000)),
      error => error.code === "AUDIT_VERIFICATION_PROGRESS_CONFLICT");
    record = { ...record, verifiedThroughSequence: "7" };
    await assert.rejects(monitor(new Date(at.getTime() + 240_000)),
      error => error.code === "AUDIT_VERIFICATION_PROGRESS_CONFLICT");
    assert.deepEqual(await receipt(), restored);

    // An equal-time invalid outcome wins regardless of arrival order. Replaying
    // that failure keeps its notification path but cannot inflate the counter.
    const failure = { valid: false, scope: "TAIL", checked: 1,
      verifiedThroughSequence: null, brokenEventId: "synthetic-race", reason: "hash mismatch" };
    record = failure;
    for (let i = 0; i < 2; i++) {
      await assert.rejects(monitor(new Date(at.getTime() + 180_000)),
        error => error.code === "AUDIT_INTEGRITY_FAILURE");
    }
    assert.equal((await receipt()).consecutiveFailures, 1);
    record = { valid: true, scope: "TAIL", checked: 3, verifiedThroughSequence: "9" };
    await assert.rejects(monitor(new Date(at.getTime() + 180_000)),
      error => error.code === "AUDIT_VERIFICATION_PROGRESS_CONFLICT");
    await monitor(new Date(at.getTime() + 300_000));
    const recovered = await receipt();
    const priorAlerts = alertCalls;
    record = failure;
    await assert.rejects(monitor(new Date(at.getTime() + 240_000)),
      error => error.code === "AUDIT_INTEGRITY_FAILURE");
    assert.deepEqual(await receipt(), recovered);
    assert.equal(alertCalls, priorAlerts + 1, "stale failures still reach the privileged notification path");

    // Exercise a verifier that starts earlier but completes only after a newer
    // failure is durably committed, using real SQL receipt writes.
    let releaseOlder;
    let signalEntered;
    const entered = new Promise(resolve => { signalEntered = resolve; });
    const delayed = new Promise(resolve => { releaseOlder = resolve; });
    const delayedMonitor = loadMonitor({ ...mocks,
      "@/lib/audit-integrity": { verifyAuditIntegrity: async () => { signalEntered(); return delayed; } }
    });
    const older = delayedMonitor(new Date(at.getTime() + 360_000));
    // Attach the rejection handler before starting the competing invocation.
    const olderRejected = assert.rejects(older,
      error => error.code === "AUDIT_VERIFICATION_PROGRESS_CONFLICT");
    await entered;
    try {
      await assert.rejects(monitor(new Date(at.getTime() + 420_000)),
        error => error.code === "AUDIT_INTEGRITY_FAILURE");
    } finally {
      releaseOlder({ valid: true, scope: "TAIL", checked: 3, verifiedThroughSequence: "10" });
    }
    await olderRejected;
    const afterOverlap = await receipt();
    assert.equal(afterOverlap.lastResult, "INVALID");
    assert.equal(afterOverlap.lastVerifiedSequence, 9n);
    assert.equal(afterOverlap.lastAttemptAt.getTime(), at.getTime() + 420_000);

    // Competing PostgreSQL writers, including the first-receipt insertion race.
    const successMonitor = loadMonitor({ ...mocks,
      "@/lib/audit-integrity": { verifyAuditIntegrity: async () => ({
        valid: true, scope: "TAIL", checked: 3, verifiedThroughSequence: "11" }) }
    });
    for (const startEmpty of [false, true]) {
      if (startEmpty) await db.auditVerificationProgress.deleteMany({ where: { tenantId } });
      const raceAt = new Date(at.getTime() + (startEmpty ? 600_000 : 540_000));
      const outcomes = await Promise.allSettled([successMonitor(raceAt), monitor(raceAt)]);
      assert.equal(outcomes[1].status, "rejected");
      assert.equal(outcomes[1].reason.code, "AUDIT_INTEGRITY_FAILURE");
      if (outcomes[0].status === "rejected") {
        assert.equal(outcomes[0].reason.code, "AUDIT_VERIFICATION_PROGRESS_CONFLICT");
      }
      const raced = await receipt();
      assert.equal(raced.lastResult, "INVALID");
      assert.equal(raced.lastAttemptAt.getTime(), raceAt.getTime());
      assert.ok(raced.lastVerifiedSequence === null || raced.lastVerifiedSequence >= 9n);
    }

    // Synthetic fixture only: prove counter saturation cannot roll back an alert.
    await db.auditVerificationProgress.update({ where: { tenantId }, data: { consecutiveFailures: 2147483647 } });
    await assert.rejects(monitor(new Date(at.getTime() + 660_000)),
      error => error.code === "AUDIT_INTEGRITY_FAILURE");
    assert.equal((await receipt()).consecutiveFailures, 2147483647);
  } finally {
    await db.auditVerificationProgress.deleteMany({ where: { tenantId } }).catch(() => {});
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await db.$disconnect();
  }
});
