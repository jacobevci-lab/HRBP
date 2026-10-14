import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { selectAuditIntegrityBatch } from "../lib/audit-integrity-batching.mjs";
import { assertAuditIntegrityRun } from "../lib/audit-integrity-outcome.mjs";

function loadMonitor(mocks) {
  const path = "lib/audit-monitoring.ts";
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  });
  return module.exports.monitorAuditIntegrity;
}

const now = new Date("2026-10-14T13:00:00.000Z");

function fixture({ tenantCount = 1, tenantBatch = 4, verificationLimit = 1500, verifyResult = null } = {}) {
  const calls = { count: 0, list: [], integrity: [], transactions: 0, notifications: [] };
  const db = {
    tenant: {
      count: async () => { calls.count++; return tenantCount; },
      findMany: async args => {
        calls.list.push(args);
        assert.deepEqual(args.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
        assert.deepEqual(args.select, { id: true });
        assert.ok(args.take * Math.min(5000, Math.max(100, verificationLimit)) <= 10_000);
        const remaining = Math.max(0, tenantCount - args.skip);
        return Array.from({ length: Math.min(args.take, remaining) }, (_, i) => ({
          id: "tenant-" + (args.skip + i)
        }));
      }
    },
    $transaction: async fn => {
      calls.transactions++;
      return fn({});
    }
  };
  const mocks = {
    "@prisma/client": {
      DataClassification: { RESTRICTED: "RESTRICTED" },
      PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN" }
    },
    "@/lib/db": { db },
    "@/lib/audit-integrity-outcome.mjs": { assertAuditIntegrityRun },
    "@/lib/audit-integrity-batching.mjs": { selectAuditIntegrityBatch },
    "@/lib/audit-integrity": {
      verifyAuditIntegrity: async (tenantId, limit) => {
        calls.integrity.push({ tenantId, limit });
        return verifyResult ? verifyResult(tenantId) : {
          valid: true, scope: "GENESIS", brokenEventId: null,
          checked: 1, reason: null, generatedAt: now.toISOString()
        };
      }
    },
    "@/lib/notification-outbox": {
      enqueueNotificationOutbox: async (_tx, input) => {
        calls.notifications.push(input);
        return { status: "PENDING" };
      }
    },
    "@/lib/runtime-env": {
      runtimeNumber: (name, fallback) =>
        name === "HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE" ? tenantBatch
          : name === "HRBP_AUDIT_INTEGRITY_CHECK_LIMIT" ? verificationLimit : fallback
    }
  };
  const monitor = loadMonitor(mocks);
  return { calls, run: (at = now) => monitor(at) };
}

test("invalid EMPTY is an integrity alert, never counted as an innocuous empty tenant", async () => {
  const f = fixture({ verifyResult: () => ({
    scope: "EMPTY", valid: false, checked: 0,
    brokenEventId: null,
    reason: "Audit ledger state is non-empty while no audit events exist.",
    generatedAt: now.toISOString()
  }) });
  await assert.rejects(f.run(), error => error.code === "AUDIT_INTEGRITY_FAILURE");
  assert.equal(f.calls.transactions, 1);
  assert.deepEqual(f.calls.notifications.map(x => ({
    tenant: x.tenantId, event: x.eventType, recipientRole: x.recipientRole,
    classification: x.classification, dedupeKey: x.dedupeKey,
    resourceType: x.resourceType, resourceId: x.resourceId
  })), [{
    tenant: "tenant-0", event: "AUDIT_INTEGRITY_FAILURE",
    recipientRole: "TENANT_ADMIN", classification: "RESTRICTED",
    dedupeKey: "audit-integrity:unknown",
    resourceType: "AuditEvent", resourceId: "unknown"
  }]);
});

test("truly valid empty audit ledger counts as empty without generating notifications", async () => {
  const f = fixture({ verifyResult: () => ({
    scope: "EMPTY", valid: true, checked: 0, brokenEventId: null,
    reason: null, generatedAt: now.toISOString()
  }) });
  const report = await f.run();
  assert.equal(report.empty, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.notificationsQueued, 0);
  assert.equal(f.calls.transactions, 0);
});

test("valid GENESIS/TAIL records and corrupted chains preserve distinct audit outcomes", async () => {
  const f = fixture({ tenantCount: 3, verifyResult: id => id.endsWith("0")
    ? { valid: true, scope: "GENESIS" }
    : id.endsWith("1")
      ? { valid: true, scope: "TAIL" }
      : {
        valid: false, scope: "TAIL", checked: 3,
        brokenEventId: "event-3", reason: "hash mismatch",
        generatedAt: now.toISOString()
      }
  });
  await assert.rejects(f.run(), error => error.code === "AUDIT_INTEGRITY_FAILURE");
  assert.equal(f.calls.integrity.length, 3);
  assert.equal(f.calls.notifications.length, 1);
  assert.equal(f.calls.notifications[0].resourceId, "event-3");
  assert.equal(f.calls.notifications[0].payload.reason, "hash mismatch");
  assert.equal(f.calls.notifications[0].tenantId, "tenant-2");
});

test("monitor never materializes all tenants, silently truncates at 10k, or exceeds hash budget", async () => {
  const f = fixture({ tenantCount: 12_345, tenantBatch: 1_000, verificationLimit: 1_500 });
  const report = await f.run();
  assert.equal(report.tenantUniverse, 12_345);
  assert.equal(report.tenantBatchSize, 6);
  assert.equal(report.maxVerificationEvents, 9_000);
  assert.equal(report.tenantsChecked, 6);
  assert.equal(f.calls.count, 1);
  assert.equal(f.calls.list.length, 1);
  assert.equal(f.calls.list[0].take, 6);
  assert.equal(f.calls.list[0].skip, report.batchIndex * 6);
  assert.equal(f.calls.integrity.length, 6);
  assert.ok(!("take" in f.calls.list[0] && f.calls.list[0].take === 10_000));
});

test("15-minute rotation advances across batches without waiting a whole UTC day", async () => {
  const f = fixture({ tenantCount: 100, tenantBatch: 4, verificationLimit: 1500 });
  const first = await f.run(now);
  const second = await f.run(new Date(now.getTime() + 15 * 60_000));
  assert.equal(first.batchCount, 25);
  assert.equal(second.batchIndex, (first.batchIndex + 1) % first.batchCount);
  assert.notDeepEqual(f.calls.integrity.slice(0, 4).map(x => x.tenantId),
    f.calls.integrity.slice(4, 8).map(x => x.tenantId));
  assert.equal(first.maxVerificationEvents, 6_000);
});

test("high per-tenant verification depth automatically reduces tenants per invocation", () => {
  const window = selectAuditIntegrityBatch({
    now, tenantCount: 100, requestedTenantBatchSize: 25, verificationLimit: 5_000
  });
  assert.equal(window.tenantBatchSize, 2);
  assert.equal(window.maxVerificationEvents, 10_000);
  assert.equal(window.batchCount, 50);
  assert.equal(window.skip, window.batchIndex * 2);
});

test("zero tenants perform no integrity verification and do not divide by zero", async () => {
  const f = fixture({ tenantCount: 0 });
  const report = await f.run();
  assert.equal(report.tenantUniverse, 0);
  assert.equal(report.batchCount, 1);
  assert.equal(report.batchIndex, 0);
  assert.equal(report.tenantsChecked, 0);
  assert.deepEqual(f.calls.integrity, []);
  assert.equal(f.calls.transactions, 0);
});

test("invalid schedule and unsafe verification settings fail before any selection", () => {
  for (const v of [new Date(NaN), "2026-10-14", null]) {
    assert.throws(() => selectAuditIntegrityBatch({
      now: v, tenantCount: 2, requestedTenantBatchSize: 4, verificationLimit: 1500
    }), RangeError);
  }
  for (const tenantCount of [-1, 1.5, NaN]) {
    assert.throws(() => selectAuditIntegrityBatch({
      now, tenantCount, requestedTenantBatchSize: 4, verificationLimit: 1500
    }), RangeError);
  }
  for (const verificationLimit of [-1, 5_001, NaN]) {
    assert.throws(() => selectAuditIntegrityBatch({
      now, tenantCount: 2, requestedTenantBatchSize: 4, verificationLimit
    }), RangeError);
  }
});

test("static monitoring contract keeps a fail-closed invalid-empty branch", () => {
  const source = readFileSync("lib/audit-monitoring.ts", "utf8");
  assert.match(source, /if \(result\.valid && result\.scope === "EMPTY"\)/);
  assert.match(source, /if \(result\.valid\)/);
  assert.match(source, /failed \+= 1/);
  assert.match(source, /AUDIT_INTEGRITY_FAILURE/);
  assert.match(source, /db\.tenant\.count\(\)/);
  assert.doesNotMatch(source, /take:\s*10_000/);
});
