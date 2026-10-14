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
  skip: process.env.CI !== "true" || process.env.HRBP_DISPOSABLE_AUDIT_LEDGER_TEST !== "true"
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
      auditVerificationProgress: {
        upsert: args => db.auditVerificationProgress.upsert(args),
        count: args => db.auditVerificationProgress.count({
          where: { tenantId, ...args.where }
        })
      },
      $transaction: fn => db.$transaction(fn)
    };
    const monitor = loadMonitor({
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
    });

    const first = await monitor(at);
    assert.equal(first.verifiedWithin24h, 1);
    assert.equal(first.staleOrUnverified24h, 0);
    const initial = await db.auditVerificationProgress.findUnique({ where: { tenantId } });
    assert.equal(initial.lastResult, "VALID");
    assert.equal(initial.lastVerifiedSequence, 7n);
    assert.equal(initial.lastVerifiedScope, "GENESIS");
    assert.equal(initial.checkedEvents, 7);
    assert.equal(initial.consecutiveFailures, 0);

    record = { valid: false, scope: "TAIL", checked: 1, brokenEventId: "synthetic-broken",
      verifiedThroughSequence: null, reason: "hash mismatch" };
    await assert.rejects(monitor(new Date(at.getTime() + 60_000)),
      error => error.code === "AUDIT_INTEGRITY_FAILURE");
    const invalid = await db.auditVerificationProgress.findUnique({ where: { tenantId } });
    assert.equal(invalid.lastResult, "INVALID");
    assert.equal(invalid.consecutiveFailures, 1);
    assert.equal(invalid.lastVerifiedSequence, 7n);
    assert.equal(invalid.lastSuccessAt.getTime(), initial.lastSuccessAt.getTime());
    assert.equal(alertCalls, 1);

    failNotification = true;
    await assert.rejects(monitor(new Date(at.getTime() + 120_000)), /SIMULATED_OUTBOX_FAILURE/);
    assert.equal((await db.auditVerificationProgress.findUnique({ where: { tenantId } })).consecutiveFailures, 1,
      "the failure receipt and privileged alert must be in one atomic transaction");

    record = { valid: true, scope: "TAIL", checked: 3,
      verifiedThroughSequence: "8", brokenEventId: null, reason: null };
    failNotification = false;
    const final = await monitor(new Date(at.getTime() + 180_000));
    assert.equal(final.verified, 1);
    const restored = await db.auditVerificationProgress.findUnique({ where: { tenantId } });
    assert.equal(restored.lastResult, "VALID");
    assert.equal(restored.lastVerifiedScope, "TAIL");
    assert.equal(restored.lastVerifiedSequence, 8n);
    assert.equal(restored.consecutiveFailures, 0);
  } finally {
    await db.auditVerificationProgress.deleteMany({ where: { tenantId } }).catch(() => {});
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await db.$disconnect();
  }
});
