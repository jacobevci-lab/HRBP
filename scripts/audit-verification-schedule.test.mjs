import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync("lib/audit-verification-schedule.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
} }).outputText;
const module = { exports: {} };
new Function("module", "exports", "require", js)(module, module.exports, require);
const { createAuditVerificationScheduler } = module.exports;
const at = new Date("2026-10-14T12:00:00Z");
const clone = value => structuredClone(value);

function fixture(count = 5) {
  let clock = at.getTime();
  let state = null;
  let receipts = new Map();
  const tenants = Array.from({ length: count }, (_, index) => ({ id: `tenant-${index}`, createdAt: at }));
  const calls = { pages: [], transactions: 0, raw: [] };
  function matches(tenant, where) {
    if (where.AND) return where.AND.every(part => matches(tenant, part));
    if (where.OR) return where.OR.some(part => matches(tenant, part));
    return Object.entries(where).every(([key, condition]) => {
      const value = key === "createdAt" ? tenant[key].getTime() : tenant[key];
      if (condition instanceof Date) return value === condition.getTime();
      return Object.entries(condition).every(([op, bound]) => {
        const other = bound instanceof Date ? bound.getTime() : bound;
        return op === "gt" ? value > other : op === "lt" ? value < other : value <= other;
      });
    });
  }
  const sorted = () => [...tenants].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
  const tx = {
    $executeRaw: async (strings, ...values) => {
      assert.ok(Array.isArray(strings.raw));
      const sql = strings.join("?");
      calls.raw.push(sql);
      if (/INSERT INTO/.test(sql)) {
        state ??= { scheduleVersion: 1, cursorTenantId: null, cursorCreatedAt: null,
          upperTenantId: null, upperCreatedAt: null, leaseToken: null, leaseExpiresAt: null };
        return 1;
      }
      assert.match(sql, /AND "leaseToken" = \? AND "scheduleVersion" = 1/);
      assert.match(sql, /clock_timestamp\(\)/);
      return state.leaseToken === values[1] && state.scheduleVersion === 1 && state.leaseExpiresAt > new Date(clock) ? 1 : 0;
    },
    $queryRaw: async (strings) => {
      assert.match(strings.join("?"), /FOR UPDATE/);
      return state ? [{ ...clone(state), databaseNow: new Date(clock) }] : [];
    },
    auditVerificationSchedule: {
      update: async ({ data }) => { Object.assign(state, clone(data)); return clone(state); },
      updateMany: async ({ where, data }) => {
        if (state?.leaseToken !== where.leaseToken) return { count: 0 };
        Object.assign(state, clone(data)); return { count: 1 };
      }
    },
    tenant: {
      findFirst: async () => sorted().at(-1) ?? null,
      findMany: async args => {
        calls.pages.push(args);
        assert.deepEqual(args.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
        assert.ok(args.take <= 26);
        assert.ok(!("skip" in args));
        return sorted().filter(t => matches(t, args.where)).slice(0, args.take).map(clone);
      }
    },
    record: async id => { receipts.set(id, (receipts.get(id) ?? 0) + 1); }
  };
  let queue = Promise.resolve();
  const db = {
    auditVerificationSchedule: tx.auditVerificationSchedule,
    $transaction: (fn, options) => {
      assert.deepEqual(options, { maxWait: 2_000, timeout: 5_000 });
      const run = queue.then(async () => {
        calls.transactions++;
        const before = clone(state), saved = clone(receipts);
        try { return await fn(tx); } catch (error) { state = before; receipts = saved; throw error; }
      });
      queue = run.catch(() => {});
      return run;
    }
  };
  const scheduler = createAuditVerificationScheduler(db);
  return { scheduler, tenants, calls, get state() { return state; }, get receipts() { return receipts; },
    advance: ms => { clock += ms; }, checkpoint: (lease, tenant) => scheduler.checkpoint(lease, tenant, tx => tx.record(tenant.id)) };
}

test("durable pages ignore skipped wall-clock slots and commit only completed tenants", async () => {
  const f = fixture();
  let lease = await f.scheduler.start(2);
  assert.deepEqual(lease.tenants.map(t => t.id), ["tenant-0", "tenant-1"]);
  await f.checkpoint(lease, lease.tenants[0]);
  await f.scheduler.release(lease); // crash after a committed first tenant
  f.advance(3 * 24 * 60 * 60_000);
  lease = await f.scheduler.start(2);
  assert.deepEqual(lease.tenants.map(t => t.id), ["tenant-1", "tenant-2"]);
  for (const tenant of lease.tenants) await f.checkpoint(lease, tenant);
  assert.equal((await f.scheduler.finish(lease)).cycleCompleted, false);
  lease = await f.scheduler.start(2);
  assert.deepEqual(lease.tenants.map(t => t.id), ["tenant-3", "tenant-4"]);
  for (const tenant of lease.tenants) await f.checkpoint(lease, tenant);
  assert.equal((await f.scheduler.finish(lease)).cycleCompleted, true);
  assert.equal(f.state.cursorTenantId, null);
  assert.equal(f.receipts.size, 5);
  assert.ok([...f.receipts.values()].every(count => count === 1));
});

test("an uncommitted receipt and cursor roll back together", async () => {
  const f = fixture();
  const lease = await f.scheduler.start(2);
  await assert.rejects(f.scheduler.checkpoint(lease, lease.tenants[0], async tx => {
    await tx.record("tenant-0"); throw new Error("SIMULATED_OUTBOX_FAILURE");
  }), /SIMULATED_OUTBOX_FAILURE/);
  assert.equal(f.state.cursorTenantId, null);
  assert.equal(lease.nextIndex, 0);
  assert.equal(f.receipts.size, 0);
  await f.scheduler.release(lease);
  assert.equal((await f.scheduler.start(2)).tenants[0].id, "tenant-0");
});

test("concurrent acquisition has one owner; busy never implies a successful check", async () => {
  const f = fixture();
  const runs = await Promise.allSettled([f.scheduler.start(2), f.scheduler.start(2)]);
  assert.equal(runs.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(runs.find(r => r.status === "rejected").reason.code, "AUDIT_SCHEDULE_BUSY");
});

test("expired ownership is replaced and late workers cannot commit or release the replacement", async () => {
  const f = fixture();
  const old = await f.scheduler.start(2);
  f.advance(120_001);
  const current = await f.scheduler.start(2);
  await assert.rejects(f.checkpoint(old, old.tenants[0]), e => e.code === "AUDIT_SCHEDULE_LEASE_LOST");
  await f.scheduler.release(old);
  assert.equal(f.state.leaseToken, current.token);
  assert.equal(f.receipts.size, 0);
  await f.checkpoint(current, current.tenants[0]);
  assert.equal(f.receipts.size, 1);
});

test("lease expiry during a receipt write rolls back both receipt and cursor", async () => {
  const f = fixture();
  const lease = await f.scheduler.start(2);
  await assert.rejects(f.scheduler.checkpoint(lease, lease.tenants[0], async tx => {
    await tx.record("tenant-0"); f.advance(120_001);
  }), e => e.code === "AUDIT_SCHEDULE_LEASE_LOST");
  assert.equal(f.receipts.size, 0);
  assert.equal(f.state.cursorTenantId, null);
});

test("the cursor cannot skip a selected tenant or finish an incomplete page", async () => {
  const f = fixture();
  const lease = await f.scheduler.start(2);
  await assert.rejects(f.checkpoint(lease, lease.tenants[1]), e => e.code === "AUDIT_SCHEDULE_ORDER_INVALID");
  await assert.rejects(f.scheduler.finish(lease), e => e.code === "AUDIT_SCHEDULE_INCOMPLETE");
  assert.equal(f.receipts.size, 0);
});

test("deleting the cursor and upper tenant does not break value-based resume", async () => {
  const f = fixture(4);
  let lease = await f.scheduler.start(1);
  await f.checkpoint(lease, lease.tenants[0]);
  await f.scheduler.finish(lease);
  f.tenants.splice(0, 1); f.tenants.pop();
  lease = await f.scheduler.start(2);
  assert.deepEqual(lease.tenants.map(t => t.id), ["tenant-1", "tenant-2"]);
  for (const t of lease.tenants) await f.checkpoint(lease, t);
  assert.equal((await f.scheduler.finish(lease)).cycleCompleted, true);
});

test("new tenants beyond the upper key and behind the cursor are covered in the next finite cycle", async () => {
  const f = fixture(2);
  let lease = await f.scheduler.start(1);
  await f.checkpoint(lease, lease.tenants[0]); await f.scheduler.finish(lease);
  f.tenants.push({ id: "new-earlier", createdAt: new Date(at.getTime() - 1) },
    { id: "new-later", createdAt: new Date(at.getTime() + 1) });
  lease = await f.scheduler.start(2);
  assert.deepEqual(lease.tenants.map(t => t.id), ["tenant-1"]);
  await f.checkpoint(lease, lease.tenants[0]);
  assert.equal((await f.scheduler.finish(lease)).cycleCompleted, true);
  lease = await f.scheduler.start(4);
  assert.deepEqual(lease.tenants.map(t => t.id), ["new-earlier", "tenant-0", "tenant-1", "new-later"]);
});

test("zero tenants finish an empty traversal without claiming any ledger verification", async () => {
  const f = fixture(0);
  const lease = await f.scheduler.start(2);
  assert.deepEqual(lease.tenants, []);
  assert.equal((await f.scheduler.finish(lease)).cycleCompleted, true);
  assert.equal(f.receipts.size, 0);
});

test("invalid or unknown scheduler state is never silently reset", async () => {
  const f = fixture();
  const lease = await f.scheduler.start(2); await f.scheduler.release(lease);
  f.state.scheduleVersion = 2;
  await assert.rejects(f.scheduler.start(2), e => e.code === "AUDIT_SCHEDULE_VERSION_UNSUPPORTED");
  assert.equal(f.state.scheduleVersion, 2);
  f.state.scheduleVersion = 1; f.state.cursorTenantId = "missing-date";
  await assert.rejects(f.scheduler.start(2), e => e.code === "AUDIT_SCHEDULE_STATE_INVALID");
});

test("batch limits are rejected before database work", async () => {
  const f = fixture();
  for (const n of [0, -1, 1.5, 26, NaN, Infinity]) {
    await assert.rejects(f.scheduler.start(n), RangeError);
  }
  assert.equal(f.calls.transactions, 0);
});

test("queries remain parameter bound, short-transaction based and payload-free", () => {
  assert.doesNotMatch(source, /\$executeRawUnsafe|\$queryRawUnsafe|Prisma\.raw\(/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /clock_timestamp\(\)/);
  assert.match(source, /const LEASE_MS = 120_000/);
  assert.match(source, /take: take \+ 1/);
  assert.doesNotMatch(source, /setInterval|setTimeout|skip:/);
});
