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
function load(path, mocks = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error("Unexpected dependency: " + name);
    return require(name);
  });
  return module.exports;
}

// This existing CI entry point now tests the real scheduler AND monitor together.
// No test may run against a remote/customer database or touch unrelated tenants.
test("durable audit scheduler and receipts survive interruption, overlap and population changes in PostgreSQL", {
  skip: process.env.CI !== "true" || process.env.HRBP_DISPOSABLE_AUDIT_LEDGER_TEST !== "true",
  timeout: 60_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");
  const db = new PrismaClient();
  const uuid = randomUUID(), prefix = `ci-audit-resume-${uuid}-`, key = `ci-audit-schedule-${uuid}`;
  const id = i => prefix + String(i).padStart(3, "0");
  const at = new Date("2026-10-14T00:00:00Z");
  const scope = { id: { startsWith: prefix } };
  const scopedTenant = tenant => ({
    findFirst: args => tenant.findFirst({ ...args, where: { AND: [scope, args.where ?? {}] } }),
    findMany: args => tenant.findMany({ ...args, where: { AND: [scope, args.where ?? {}] } })
  });
  const scopedDb = {
    tenant: { count: () => db.tenant.count({ where: scope }) },
    auditVerificationSchedule: db.auditVerificationSchedule,
    auditVerificationProgress: { count: args => db.auditVerificationProgress.count({
      where: { AND: [{ tenantId: { startsWith: prefix } }, args.where] }
    }) },
    $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, {
      get(target, prop) {
        if (prop === "tenant") return scopedTenant(tx.tenant);
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      }
    })), options)
  };
  const { createAuditVerificationScheduler } = load("lib/audit-verification-schedule.ts");
  const scheduler = createAuditVerificationScheduler(scopedDb, key);
  const good = sequence => ({ valid: true, scope: "TAIL", checked: 3, verifiedThroughSequence: sequence, brokenEventId: null });
  const bad = { valid: false, scope: "TAIL", checked: 1, verifiedThroughSequence: null,
    brokenEventId: "synthetic-broken", reason: "hash mismatch", generatedAt: at.toISOString() };
  let verify = async () => good("7");
  let failNotification = false, alertCalls = 0;
  const { monitorAuditIntegrity: monitor } = load("lib/audit-monitoring.ts", {
    "@/lib/db": { db: scopedDb },
    "@/lib/audit-integrity": { verifyAuditIntegrity: (...args) => verify(...args) },
    "@/lib/audit-integrity-batching.mjs": { selectAuditIntegrityBatch },
    "@/lib/audit-integrity-outcome.mjs": { assertAuditIntegrityRun },
    "@/lib/audit-verification-schedule": { createAuditVerificationScheduler: () => scheduler },
    "@/lib/notification-outbox": { enqueueNotificationOutbox: async (tx, input) => {
      assert.ok(tx.auditVerificationProgress && tx.auditVerificationSchedule);
      assert.equal(input.recipientRole, "TENANT_ADMIN"); assert.equal(input.classification, "RESTRICTED");
      alertCalls++;
      if (failNotification) throw new Error("SIMULATED_OUTBOX_FAILURE");
      return { status: "PENDING" };
    } },
    "@/lib/runtime-env": { runtimeNumber: (name, fallback) => name === "HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE" ? 2 : fallback }
  });
  const state = () => db.auditVerificationSchedule.findUnique({ where: { id: key } });
  const receipt = tenantId => db.auditVerificationProgress.findUnique({ where: { tenantId } });
  const integrityFailure = e => e.code === "AUDIT_INTEGRITY_FAILURE";
  const leaseLost = e => e.code === "AUDIT_SCHEDULE_LEASE_LOST";
  try {
    for (let i = 0; i < 5; i++) await db.tenant.create({ data: {
      id: id(i), name: "Synthetic resumable audit CI", region: "test", createdAt: at
    } });
    const first = await monitor(at);
    assert.equal(first.tenantsChecked, 2); assert.equal(first.cycleCompleted, false);
    assert.equal(first.verifiedWithin24h, 2); assert.equal(first.staleOrUnverified24h, 3);
    assert.equal((await state()).cursorTenantId, id(1));
    assert.equal((await receipt(id(0))).lastVerifiedSequence, 7n);

    verify = async tenantId => {
      if (tenantId === id(3)) throw new Error("SIMULATED_VERIFIER_INTERRUPTION");
      return good("7");
    };
    await assert.rejects(monitor(new Date(+at + 60_000)), /SIMULATED_VERIFIER_INTERRUPTION/);
    assert.equal((await state()).cursorTenantId, id(2));
    assert.equal((await state()).leaseToken, null);
    assert.equal(await receipt(id(3)), null);
    verify = async () => good("7");
    const resumed = await monitor(new Date(+at + 3 * 86400_000));
    assert.equal(resumed.tenantsChecked, 2); assert.equal(resumed.cycleCompleted, true);
    assert.equal((await state()).cursorTenantId, null);
    assert.equal(await db.auditVerificationProgress.count({ where: { tenantId: { startsWith: prefix } } }), 5);

    verify = async tenantId => tenantId === id(0) ? bad : good("7");
    failNotification = true;
    const beforeFailure = await receipt(id(0));
    await assert.rejects(monitor(new Date(+at + 4 * 86400_000)), /SIMULATED_OUTBOX_FAILURE/);
    assert.deepEqual(await receipt(id(0)), beforeFailure);
    assert.equal((await state()).cursorTenantId, null);
    failNotification = false;
    await assert.rejects(monitor(new Date(+at + 4 * 86400_000)), integrityFailure);
    assert.equal((await state()).cursorTenantId, id(1));
    const invalid = await receipt(id(0));
    assert.equal(invalid.lastResult, "INVALID"); assert.equal(invalid.consecutiveFailures, 1);
    assert.equal(invalid.lastVerifiedSequence, 7n); assert.equal(alertCalls, 2);
    assert.equal((await receipt(id(1))).lastResult, "VALID", "a bad ledger must not starve later tenants");

    verify = async () => good("6");
    await assert.rejects(monitor(new Date(+at + 5 * 86400_000)), e => e.code === "AUDIT_VERIFICATION_PROGRESS_CONFLICT");
    assert.equal((await state()).cursorTenantId, id(1));
    assert.equal((await receipt(id(2))).lastVerifiedSequence, 7n);

    // Competing acquisitions use the actual row lock and database lease clock.
    const acquisition = await Promise.allSettled([scheduler.start(2), scheduler.start(2)]);
    const winners = acquisition.filter(r => r.status === "fulfilled");
    assert.equal(winners.length, 1);
    assert.equal(acquisition.find(r => r.status === "rejected").reason.code, "AUDIT_SCHEDULE_BUSY");
    const old = winners[0].value;
    await db.auditVerificationSchedule.update({ where: { id: key }, data: { leaseExpiresAt: new Date(0) } });
    const current = await scheduler.start(2);
    assert.equal(current.tenants[0].id, id(2));
    await assert.rejects(scheduler.checkpoint(old, old.tenants[0], async () => {
      throw new Error("stale callback must not execute");
    }), leaseLost);
    await scheduler.release(old);
    assert.equal((await state()).leaseToken, current.token);

    // Expiry occurring DURING callback work must roll back receipt and cursor.
    const beforeExpiry = await receipt(id(2));
    await assert.rejects(scheduler.checkpoint(current, current.tenants[0], async tx => {
      await tx.auditVerificationProgress.update({ where: { tenantId: id(2) }, data: { checkedEvents: 99 } });
      await tx.auditVerificationSchedule.update({ where: { id: key }, data: { leaseExpiresAt: new Date(0) } });
    }), leaseLost);
    assert.deepEqual(await receipt(id(2)), beforeExpiry);
    assert.equal((await state()).cursorTenantId, id(1));
    assert.equal(current.nextIndex, 0);
    await scheduler.checkpoint(current, current.tenants[0], async tx => {
      await tx.auditVerificationProgress.update({ where: { tenantId: id(2) }, data: { checkedEvents: 3 } });
    });
    await scheduler.release(current);

    // Removing both stored boundary tenants leaves resumable value keys intact.
    await db.tenant.deleteMany({ where: { id: { in: [id(2), id(4)] } } });
    await db.tenant.create({ data: { id: prefix + "earlier", name: "Synthetic earlier", region: "test", createdAt: new Date(+at - 1) } });
    await db.tenant.create({ data: { id: prefix + "later", name: "Synthetic later", region: "test", createdAt: new Date(+at + 1) } });
    const tail = await scheduler.start(2);
    assert.deepEqual(tail.tenants.map(t => t.id), [id(3)]);
    await scheduler.checkpoint(tail, tail.tenants[0], async () => undefined);
    assert.equal((await scheduler.finish(tail)).cycleCompleted, true);
    const next = await scheduler.start(25);
    assert.deepEqual(next.tenants.map(t => t.id), [prefix + "earlier", id(0), id(1), id(3), prefix + "later"]);
    const sameLeaseRace = await Promise.allSettled([
      scheduler.checkpoint(next, next.tenants[0], async () => undefined),
      scheduler.checkpoint(next, next.tenants[0], async () => undefined)
    ]);
    assert.equal(sameLeaseRace.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(sameLeaseRace.find(r => r.status === "rejected").reason.code, "AUDIT_SCHEDULE_LEASE_LOST");
    assert.equal(next.nextIndex, 1, "duplicate callbacks must not skip an unprocessed tenant");
    await scheduler.release(next);

    // Never downgrade/reset a scheduler from an unknown application version.
    await db.auditVerificationSchedule.update({ where: { id: key }, data: { scheduleVersion: 2 } });
    await assert.rejects(scheduler.start(2), e => e.code === "AUDIT_SCHEDULE_VERSION_UNSUPPORTED");
    assert.equal((await state()).scheduleVersion, 2);

    // True simultaneous first-row insertion (not just an existing-row race).
    await db.auditVerificationSchedule.delete({ where: { id: key } });
    const firstRace = await Promise.allSettled([scheduler.start(2), scheduler.start(2)]);
    assert.equal(firstRace.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(firstRace.find(r => r.status === "rejected").reason.code, "AUDIT_SCHEDULE_BUSY");
    await scheduler.release(firstRace.find(r => r.status === "fulfilled").value);

    await db.tenant.deleteMany({ where: scope });
    const empty = await monitor(new Date(+at + 6 * 86400_000));
    assert.equal(empty.tenantsChecked, 0); assert.equal(empty.verifiedWithin24h, 0);
    assert.equal(empty.cycleCompleted, true);
  } finally {
    await db.auditVerificationSchedule.deleteMany({ where: { id: key } }).catch(() => {});
    await db.tenant.deleteMany({ where: scope }).catch(() => {});
    await db.$disconnect();
  }
});
