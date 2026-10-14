import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fullAuditHash, auditHistoryOptions, auditHistoryCliArgs, verifyFullAuditHistory } from "./audit-full-history-verification.mjs";

const tenantId = "ci-audit-history";
const date = new Date("2026-10-14T12:00:00.000Z");
function events(count) {
  let previousHash = null;
  return Array.from({ length: count }, (_, i) => {
    const row = {
      tenantId, ledgerSequence: String(i + 1), actorId: "ci-actor",
      action: "audit.probe", resourceType: "TestEvent", resourceId: "ci-resource-" + i,
      purpose: "Operator-only historical integrity check", classification: "INTERNAL",
      ipAddress: null, occurredAt: date, previousHash
    };
    row.hash = fullAuditHash(row, previousHash);
    previousHash = row.hash;
    return row;
  });
}

function harness(rows, { state = rows.length ? { eventCount: String(rows.length), tailHash: rows.at(-1).hash } : null,
  tenantExists = true, injectTenantRow = false, afterBegin = null } = {}) {
  const calls = [];
  let snapshotRows = [];
  let inTx = false;
  const client = {
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql.startsWith("BEGIN ")) {
        assert.match(sql, /ISOLATION LEVEL REPEATABLE READ READ ONLY/);
        inTx = true;
        snapshotRows = structuredClone(rows);
        if (afterBegin) afterBegin(rows);
        return { rows: [] };
      }
      if (sql === "ROLLBACK") { assert.equal(inTx, true); inTx = false; return { rows: [] }; }
      assert.equal(inTx, true, "every audit read must be in the same read-only snapshot");
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      assert.ok(!/\b(?:INSERT|DELETE|UPDATE|ALTER|TRUNCATE)\b/i.test(sql), "audit scan never mutates data");
      assert.equal(args[0], tenantId, "all tenant-scoped reads are bound to the same tenant");
      if (sql.includes('FROM "Tenant"')) return { rows: tenantExists ? [{ id: tenantId }] : [] };
      if (sql.includes('FROM "AuditLedgerState"')) return { rows: state ? [state] : [] };
      assert.match(sql, /FROM "AuditEvent"/);
      assert.match(sql, /ORDER BY "ledgerSequence" ASC LIMIT \$3/);
      assert.equal(args.length, 3);
      const cutoff = BigInt(args[1]);
      let matches = snapshotRows.filter(x => BigInt(x.ledgerSequence) > cutoff);
      if (injectTenantRow && cutoff === 0n) matches = [{ ...matches[0], tenantId: "other-tenant" }];
      return { rows: matches.slice(0, args[2]) };
    }
  };
  return { client, calls, inTx: () => inTx };
}

test("entire ledger scans contiguous bounded pages, including pre-tail history, and leaves no open transaction", async () => {
  const h = harness(events(12));
  const result = await verifyFullAuditHistory(h.client, { tenantId, batchSize: 3, maxEvents: 20 });
  assert.deepEqual(result, { valid: true, complete: true, code: "FULL_CHAIN_VERIFIED", eventsChecked: 12,
    lastSequence: "12", scope: "FULL_READ_ONLY_SNAPSHOT" });
  assert.equal(h.inTx(), false);
  assert.equal(h.calls.at(-1).sql, "ROLLBACK");
  assert.ok(h.calls.filter(x => x.sql.includes('FROM "AuditEvent"')).length >= 4);
  assert.ok(h.calls.every(x => x.sql === "ROLLBACK" || x.sql.startsWith("BEGIN") ||
    x.sql.startsWith("SET LOCAL") || x.args[0] === tenantId));
});

test("corruption far earlier than a healthy-looking tail is detected", async () => {
  const rows = events(45);
  const originalTailHash = rows.at(-1).hash;
  rows[1].action = "unauthorized-drift";
  const h = harness(rows, { state: { eventCount: "45", tailHash: originalTailHash } });
  const result = await verifyFullAuditHistory(h.client, { tenantId, batchSize: 4, maxEvents: 100 });
  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
  assert.equal(result.code, "EVENT_HASH_MISMATCH");
  assert.equal(result.eventsChecked, 1);
  assert.equal(h.inTx(), false);
});

test("missing historical record, changed previous hash and forged state all fail closed", async () => {
  const withoutSecond = events(4).filter(x => x.ledgerSequence !== "2");
  const wrongPrev = events(3);
  wrongPrev[2].previousHash = "b".repeat(64);
  const wrongTail = events(3);
  for (const [rows, state, code] of [
    [withoutSecond, { eventCount: "4", tailHash: withoutSecond.at(-1).hash }, "SEQUENCE_GAP"],
    [wrongPrev, { eventCount: "3", tailHash: wrongPrev.at(-1).hash }, "PREVIOUS_HASH_MISMATCH"],
    [wrongTail, { eventCount: "3", tailHash: "a".repeat(64) }, "LEDGER_TAIL_MISMATCH"],
    [events(1), null, "MISSING_LEDGER_STATE"]
  ]) {
    const h = harness(rows, { state });
    const result = await verifyFullAuditHistory(h.client, { tenantId });
    assert.equal(result.code, code);
    assert.equal(result.valid, false);
    assert.equal(h.inTx(), false);
  }
});

test("empty tenant, missing tenant and impossible ledger state are distinct outcomes", async () => {
  assert.equal((await verifyFullAuditHistory(harness([]).client, { tenantId })).code, "VALID_EMPTY");
  assert.equal((await verifyFullAuditHistory(harness([], { tenantExists: false }).client, { tenantId })).code, "TENANT_NOT_FOUND");
  assert.equal((await verifyFullAuditHistory(harness([], { state: { eventCount: "3", tailHash: null } }).client,
    { tenantId })).code, "INVALID_LEDGER_STATE");
});

test("insufficient scan budget cannot be mistaken for a completed valid history", async () => {
  const h = harness(events(6));
  const result = await verifyFullAuditHistory(h.client, { tenantId, maxEvents: 5, batchSize: 2 });
  assert.equal(result.code, "VERIFICATION_BUDGET_EXCEEDED");
  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
  assert.equal(h.calls.filter(x => x.sql.includes('FROM "AuditEvent"')).length, 0);
});

test("changing external data after the snapshot begins does not give a false corruption verdict", async () => {
  const rows = events(5);
  const h = harness(rows, { afterBegin: data => { data.push({ ...data[0], ledgerSequence: "999" }); } });
  assert.equal((await verifyFullAuditHistory(h.client, { tenantId, batchSize: 2 })).valid, true);
  assert.equal(h.inTx(), false);
});

test("wrong tenant rows are never accepted by scan", async () => {
  const h = harness(events(2), { injectTenantRow: true });
  const result = await verifyFullAuditHistory(h.client, { tenantId });
  assert.equal(result.code, "CROSS_TENANT_ROW");
  assert.equal(result.valid, false);
});

test("operator args enforce explicit acknowledgement, tenant and cost limits", () => {
  assert.deepEqual(auditHistoryCliArgs(["--tenant-id", tenantId, "--acknowledge-read-only-scan"]),
    auditHistoryOptions({ tenantId }));
  for (const args of [
    [], ["--tenant-id", tenantId], ["--tenant-id", "a;DROP TABLE", "--acknowledge-read-only-scan"],
    ["--tenant-id", tenantId, "--max-events", "0", "--acknowledge-read-only-scan"],
    ["--tenant-id", tenantId, "--max-events", "1000001", "--acknowledge-read-only-scan"],
    ["--tenant-id", tenantId, "--max-events", "abc", "--acknowledge-read-only-scan"],
    ["--tenant-id", tenantId, "--batch-size", "1001", "--acknowledge-read-only-scan"],
    ["--tenant-id", tenantId, "--tenant-id", tenantId, "--acknowledge-read-only-scan"]
  ]) assert.throws(() => auditHistoryCliArgs(args), RangeError);
});

test("audit hash follows application hash format, with no raw audit events returned", async () => {
  const row = events(1)[0];
  const payload = JSON.stringify({
    tenantId: row.tenantId, actorId: row.actorId, action: row.action, resourceType: row.resourceType,
    resourceId: row.resourceId, purpose: row.purpose, classification: row.classification,
    ipAddress: row.ipAddress, occurredAt: row.occurredAt.toISOString()
  });
  assert.equal(fullAuditHash(row, null), createHash("sha256").update("GENESIS|" + payload).digest("hex"));
  const result = await verifyFullAuditHistory(harness(events(1)).client, { tenantId });
  assert.ok(!JSON.stringify(result).includes("ci-resource"));
  assert.ok(!JSON.stringify(result).includes(tenantId));
});
