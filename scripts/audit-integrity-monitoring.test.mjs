import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { selectAuditIntegrityBatch } from "../lib/audit-integrity-batching.mjs";
import { assertAuditIntegrityRun } from "../lib/audit-integrity-outcome.mjs";

const now = new Date("2026-10-14T13:00:00Z");
function fixture({ tenantCount = 1, tenantBatch = 4, limit = 1500, verifyResult, failNotification = false, startError = false } = {}) {
  const progress = new Map();
  const calls = { verifications: [], starts: [], committed: [], notifications: [], releases: 0, count: 0 };
  let cursor = 0;
  // Component double only. Real durable selection/lease/fencing SQL is tested
  // separately and in audit-verification-progress.postgres.test.mjs.
  const tx = { $executeRaw: async (strings, ...values) => {
    assert.ok(Array.isArray(strings.raw));
    const [tenantId, at] = values;
    const current = progress.get(tenantId);
    if (values.length === 6) {
      const [, , , sequence, scope, checked] = values;
      if (current && (current.lastAttemptAt > at ||
          (current.lastAttemptAt.getTime() === at.getTime() && current.lastResult !== "VALID") ||
          (current.lastVerifiedSequence != null && current.lastVerifiedSequence > sequence))) return 0;
      progress.set(tenantId, { ...current, lastAttemptAt: at, lastSuccessAt: at, lastResult: "VALID",
        lastVerifiedSequence: sequence, lastVerifiedScope: scope, checkedEvents: checked, consecutiveFailures: 0 });
    } else {
      assert.equal(values.length, 4);
      if (current && current.lastAttemptAt > at) return 0;
      const duplicate = current?.lastAttemptAt.getTime() === at.getTime() && current.lastResult === "INVALID";
      progress.set(tenantId, { ...current, lastAttemptAt: at, lastFailureAt: at, lastResult: "INVALID",
        checkedEvents: values[3], consecutiveFailures: duplicate ? current.consecutiveFailures
          : Math.min(2147483647, (current?.consecutiveFailures ?? 0) + 1) });
    }
    return 1;
  } };
  const db = {
    tenant: { count: async () => { calls.count++; return tenantCount; } },
    auditVerificationProgress: { count: async args => [...progress.values()].filter(p =>
      p.lastResult === args.where.lastResult && p.lastSuccessAt >= args.where.lastSuccessAt.gte).length },
    $executeRaw: () => { throw new Error("receipt escaped its cursor transaction"); }
  };
  const scheduler = {
    start: async take => {
      calls.starts.push(take);
      if (startError) throw Object.assign(new Error("busy"), { code: "AUDIT_SCHEDULE_BUSY" });
      const length = Math.min(take, Math.max(0, tenantCount - cursor));
      return { tenants: Array.from({ length }, (_, i) => ({ id: `tenant-${cursor + i}`, createdAt: now })) };
    },
    checkpoint: async (_lease, tenant, persist) => {
      const saved = structuredClone(progress), alerts = calls.notifications.length;
      try {
        const value = await persist(tx);
        calls.committed.push(tenant.id);
        cursor = (+tenant.id.slice(7) + 1) % Math.max(1, tenantCount);
        return value;
      } catch (e) {
        progress.clear(); for (const [key, value] of saved) progress.set(key, value);
        calls.notifications.length = alerts;
        throw e;
      }
    },
    finish: async () => ({ scheduleVersion: 1, selectionMode: "DURABLE_KEYSET", cycleCompleted: cursor === 0 }),
    release: async () => { calls.releases++; }
  };
  const mocks = {
    "@prisma/client": { DataClassification: { RESTRICTED: "RESTRICTED" }, PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN" } },
    "@/lib/db": { db },
    "@/lib/audit-integrity-outcome.mjs": { assertAuditIntegrityRun },
    "@/lib/audit-integrity-batching.mjs": { selectAuditIntegrityBatch },
    "@/lib/audit-verification-schedule": { createAuditVerificationScheduler: value => { assert.equal(value, db); return scheduler; } },
    "@/lib/audit-integrity": { verifyAuditIntegrity: async (id, requestedLimit) => {
      calls.verifications.push({ id, limit: requestedLimit });
      return verifyResult ? await verifyResult(id) : { valid: true, scope: "GENESIS", checked: 1, verifiedThroughSequence: "1" };
    } },
    "@/lib/notification-outbox": { enqueueNotificationOutbox: async (client, input) => {
      assert.equal(client, tx); calls.notifications.push(input);
      if (failNotification) throw new Error("SIMULATED_OUTBOX_FAILURE");
      return { status: "PENDING" };
    } },
    "@/lib/runtime-env": { runtimeNumber: (name, fallback) => name === "HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE"
      ? tenantBatch : name === "HRBP_AUDIT_INTEGRITY_CHECK_LIMIT" ? limit : fallback }
  };
  const js = ts.transpileModule(readFileSync("lib/audit-monitoring.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (!(name in mocks)) throw new Error("Unexpected dependency: " + name);
    return mocks[name];
  });
  return { progress, calls, run: (at = now) => module.exports.monitorAuditIntegrity(at) };
}
const valid = (sequence = "7", scope = "TAIL") => ({ valid: true, scope, checked: scope === "EMPTY" ? 0 : 3, verifiedThroughSequence: sequence });
const invalid = (scope = "TAIL") => ({ valid: false, scope, checked: 0, verifiedThroughSequence: null, brokenEventId: "broken", reason: "hash mismatch" });
const integrityFailure = e => e.code === "AUDIT_INTEGRITY_FAILURE";
const conflict = e => e.code === "AUDIT_VERIFICATION_PROGRESS_CONFLICT";

test("invalid EMPTY alerts restricted administrators, commits failure and remains RED", async () => {
  const f = fixture({ verifyResult: () => invalid("EMPTY") });
  await assert.rejects(f.run(), integrityFailure);
  assert.equal(f.progress.get("tenant-0").lastResult, "INVALID");
  assert.equal(f.progress.get("tenant-0").lastSuccessAt, undefined);
  assert.deepEqual(f.calls.committed, ["tenant-0"]);
  const alert = f.calls.notifications[0];
  assert.equal(alert.recipientRole, "TENANT_ADMIN");
  assert.equal(alert.classification, "RESTRICTED");
  assert.equal(alert.eventType, "AUDIT_INTEGRITY_FAILURE");
  assert.equal(f.calls.releases, 1);
});

test("valid EMPTY is persisted through the same cursor transaction without an alert", async () => {
  const f = fixture({ verifyResult: () => valid("0", "EMPTY") });
  const report = await f.run();
  assert.equal(report.empty, 1); assert.equal(report.verified, 0);
  assert.equal(report.verifiedWithin24h, 1); assert.equal(report.staleOrUnverified24h, 0);
  assert.equal(f.progress.get("tenant-0").lastVerifiedSequence, 0n);
  assert.equal(f.calls.notifications.length, 0);
});

test("mixed results do not let an invalid tenant starve later tenants", async () => {
  const f = fixture({ tenantCount: 3, verifyResult: id => id === "tenant-1" ? invalid() : valid() });
  await assert.rejects(f.run(), integrityFailure);
  assert.deepEqual(f.calls.committed, ["tenant-0", "tenant-1", "tenant-2"]);
  assert.equal(f.progress.get("tenant-2").lastResult, "VALID");
  assert.equal(f.calls.notifications.length, 1);
});

test("large populations use the complete count and the existing 10000-event budget", async () => {
  const f = fixture({ tenantCount: 12345, tenantBatch: 1000 });
  const report = await f.run();
  assert.equal(report.tenantUniverse, 12345);
  assert.equal(report.tenantBatchSize, 6); assert.equal(report.maxVerificationEvents, 9000);
  assert.equal(report.tenantsChecked, 6); assert.equal(report.staleOrUnverified24h, 12339);
  assert.deepEqual(f.calls.starts, [6]); assert.equal(f.calls.count, 1);
});

test("increased verification depth reduces the selected tenant budget", async () => {
  const f = fixture({ tenantCount: 100, tenantBatch: 25, limit: 5000 });
  const report = await f.run();
  assert.equal(report.tenantBatchSize, 2); assert.equal(report.maxVerificationEvents, 10000);
  assert.ok(f.calls.verifications.every(value => value.limit === 5000));
});

test("zero tenants do not claim any verified ledger", async () => {
  const f = fixture({ tenantCount: 0 });
  const report = await f.run();
  assert.equal(report.tenantsChecked, 0); assert.equal(report.verifiedWithin24h, 0);
  assert.equal(report.staleOrUnverified24h, 0); assert.equal(f.calls.verifications.length, 0);
});

test("failure preserves the known-good sequence and recovery resets its counter", async () => {
  let result = valid("127");
  const f = fixture({ verifyResult: () => result });
  await f.run(); result = invalid();
  await assert.rejects(f.run(new Date(+now + 1)), integrityFailure);
  assert.equal(f.progress.get("tenant-0").lastVerifiedSequence, 127n);
  assert.equal(f.progress.get("tenant-0").consecutiveFailures, 1);
  result = valid("128"); await f.run(new Date(+now + 2));
  assert.equal(f.progress.get("tenant-0").consecutiveFailures, 0);
});

test("unsafe or missing confirmed sequences never commit a receipt or cursor", async () => {
  for (const sequence of [null, "-1", "bad", "9223372036854775808"]) {
    const f = fixture({ verifyResult: () => valid(sequence) });
    await assert.rejects(f.run(), /sequence/);
    assert.equal(f.progress.size, 0); assert.equal(f.calls.committed.length, 0);
  }
});

test("late success cannot erase a newer invalid outcome", async () => {
  let result = invalid(); const f = fixture({ verifyResult: () => result });
  await assert.rejects(f.run(new Date(+now + 1)), integrityFailure);
  result = valid(); await assert.rejects(f.run(), conflict);
  assert.equal(f.progress.get("tenant-0").lastResult, "INVALID");
});

test("a later success cannot regress its sequence watermark", async () => {
  let result = valid("10"); const f = fixture({ verifyResult: () => result });
  await f.run(); result = valid("9");
  await assert.rejects(f.run(new Date(+now + 1)), conflict);
  assert.equal(f.progress.get("tenant-0").lastVerifiedSequence, 10n);
});

test("a delayed failure still alerts but does not erase a newer recovery", async () => {
  let result = valid(); const f = fixture({ verifyResult: () => result });
  await f.run(new Date(+now + 1)); result = invalid();
  await assert.rejects(f.run(), integrityFailure);
  assert.equal(f.progress.get("tenant-0").lastResult, "VALID");
  assert.equal(f.calls.notifications.length, 1);
});

test("equal-time invalid wins; duplicate failures do not inflate the counter", async () => {
  let result = valid(); const f = fixture({ verifyResult: () => result });
  await f.run(); result = invalid();
  for (let i = 0; i < 2; i++) await assert.rejects(f.run(), integrityFailure);
  assert.equal(f.progress.get("tenant-0").consecutiveFailures, 1);
  result = valid("8"); await assert.rejects(f.run(), conflict);
});

test("failure counters saturate rather than losing the alert to integer overflow", async () => {
  const f = fixture({ verifyResult: () => invalid() });
  await assert.rejects(f.run(), integrityFailure);
  f.progress.get("tenant-0").consecutiveFailures = 2147483647;
  await assert.rejects(f.run(new Date(+now + 1)), integrityFailure);
  assert.equal(f.progress.get("tenant-0").consecutiveFailures, 2147483647);
});

test("outbox failure rolls back the receipt and does not advance the cursor", async () => {
  const f = fixture({ failNotification: true, verifyResult: () => invalid() });
  await assert.rejects(f.run(), /SIMULATED_OUTBOX_FAILURE/);
  assert.equal(f.progress.size, 0); assert.equal(f.calls.committed.length, 0);
  assert.equal(f.calls.releases, 1);
});

test("verifier exceptions preserve partial progress and release owned work", async () => {
  const f = fixture({ tenantCount: 3, verifyResult: id => {
    if (id === "tenant-1") throw new Error("SIMULATED_DB_ERROR"); return valid();
  } });
  await assert.rejects(f.run(), /SIMULATED_DB_ERROR/);
  assert.deepEqual(f.calls.committed, ["tenant-0"]);
  assert.equal(f.calls.releases, 1);
});

test("a busy scheduler fails before reading any audit ledger", async () => {
  const f = fixture({ startError: true });
  await assert.rejects(f.run(), e => e.code === "AUDIT_SCHEDULE_BUSY");
  assert.equal(f.calls.verifications.length, 0);
});

test("internal reporting exposes aggregates, not cursor IDs or lease credentials", async () => {
  const report = await fixture().run();
  assert.equal(report.selectionMode, "DURABLE_KEYSET");
  assert.equal(report.scheduleVersion, 1);
  assert.ok(!("batchIndex" in report) && !("quarterHourSlot" in report));
  assert.doesNotMatch(JSON.stringify(report), /tenant-0|leaseToken|cursorTenantId/);
});

test("invalid timestamps and budget settings remain rejected", () => {
  for (const now of [new Date(NaN), null, "date"]) assert.throws(() => selectAuditIntegrityBatch({
    now, tenantCount: 1, requestedTenantBatchSize: 4, verificationLimit: 1500
  }), RangeError);
  for (const tenantCount of [-1, 1.5, NaN]) assert.throws(() => selectAuditIntegrityBatch({
    now, tenantCount, requestedTenantBatchSize: 4, verificationLimit: 1500
  }), RangeError);
});
