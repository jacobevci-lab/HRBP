import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyAuditHistoryChunk } from "../lib/audit-history-chunk.mjs";

function hash(row, previousHash) {
  const payload = JSON.stringify({
    tenantId: row.tenantId, actorId: row.actorId, action: row.action,
    resourceType: row.resourceType, resourceId: row.resourceId, purpose: row.purpose,
    classification: row.classification, ipAddress: row.ipAddress,
    occurredAt: row.occurredAt.toISOString()
  });
  return createHash("sha256").update((previousHash ?? "GENESIS") + "|" + payload).digest("hex");
}
function ledger(count = 5, tenantId = "tenant-a") {
  const rows = [];
  let previousHash = null;
  for (let i = 1; i <= count; i++) {
    const row = {
      tenantId, ledgerSequence: BigInt(i), actorId: "system:test", action: "audit.test",
      resourceType: "Fixture", resourceId: "row-" + i, purpose: "history resume",
      classification: "INTERNAL", ipAddress: null, occurredAt: new Date("2026-10-25T00:00:00Z"),
      previousHash
    };
    row.hash = hash(row, previousHash); previousHash = row.hash; rows.push(row);
  }
  return rows;
}
function client(rows) {
  const calls = { first: 0, pages: [] };
  return {
    calls,
    auditEvent: {
      async findFirst({ where }) {
        calls.first++;
        const row = rows.find(r => r.tenantId === where.tenantId && r.ledgerSequence === where.ledgerSequence);
        return row ? { hash: row.hash } : null;
      },
      async findMany({ where, orderBy, take }) {
        assert.deepEqual(orderBy, { ledgerSequence: "asc" });
        assert.ok(take >= 1 && take <= 1000);
        calls.pages.push({ where, take });
        return rows.filter(r => r.tenantId === where.tenantId &&
          r.ledgerSequence > where.ledgerSequence.gt &&
          r.ledgerSequence <= where.ledgerSequence.lte)
          .sort((a, b) => Number(a.ledgerSequence - b.ledgerSequence)).slice(0, take);
      }
    }
  };
}
function progress(rows, verifiedSequence = 0n, targetSequence = BigInt(rows.length)) {
  return {
    tenantId: rows[0]?.tenantId ?? "tenant-a", scanVersion: 1, scheduleVersion: 1, status: "RUNNING",
    targetSequence, targetTailHash: targetSequence === 0n ? null : rows[Number(targetSequence - 1n)]?.hash ?? null,
    verifiedSequence,
    verifiedHash: verifiedSequence === 0n ? null : rows[Number(verifiedSequence - 1n)]?.hash ?? null
  };
}

test("bounded chunks resume from the persisted anchor and complete the fixed target", async () => {
  const rows = ledger(5), db = client(rows);
  let state = progress(rows);
  const one = await verifyAuditHistoryChunk(db, state, 2, hash);
  assert.deepEqual({ valid: one.valid, complete: one.complete, checked: one.checked, sequence: one.nextSequence },
    { valid: true, complete: false, checked: 2, sequence: 2n });
  state = { ...state, verifiedSequence: one.nextSequence, verifiedHash: one.nextHash };
  const two = await verifyAuditHistoryChunk(db, state, 2, hash);
  assert.equal(two.nextSequence, 4n); assert.equal(two.complete, false);
  state = { ...state, verifiedSequence: two.nextSequence, verifiedHash: two.nextHash };
  const three = await verifyAuditHistoryChunk(db, state, 2, hash);
  assert.equal(three.valid, true); assert.equal(three.complete, true);
  assert.equal(three.nextSequence, 5n); assert.equal(three.nextHash, rows[4].hash);
  assert.equal(db.calls.pages.length, 3);
});

test("a concurrent append beyond the captured target is deferred to a later scan", async () => {
  const rows = ledger(6), db = client(rows);
  const state = progress(rows, 4n, 5n);
  const result = await verifyAuditHistoryChunk(db, state, 10, hash);
  assert.equal(result.valid, true); assert.equal(result.complete, true);
  assert.equal(result.nextSequence, 5n); assert.equal(result.checked, 1);
  assert.equal(db.calls.pages[0].where.ledgerSequence.lte, 5n);
});

test("a changed persisted resume anchor fails before scanning later rows", async () => {
  const rows = ledger(5), state = progress(rows, 2n), db = client(rows);
  rows[1] = { ...rows[1], hash: "f".repeat(64) };
  const result = await verifyAuditHistoryChunk(db, state, 2, hash);
  assert.equal(result.valid, false); assert.equal(result.code, "RESUME_ANCHOR_MISMATCH");
  assert.equal(result.checked, 0); assert.equal(db.calls.pages.length, 0);
});

test("missing or reordered historical sequences never advance the saved watermark", async () => {
  const rows = ledger(5), state = progress(rows, 2n), db = client(rows.filter(r => r.ledgerSequence !== 3n));
  const result = await verifyAuditHistoryChunk(db, state, 3, hash);
  assert.equal(result.valid, false); assert.equal(result.code, "SEQUENCE_GAP");
  assert.equal(result.nextSequence, 2n); assert.equal(result.nextHash, rows[1].hash);
});

test("the captured target hash detects a consistently shaped but different target", async () => {
  const rows = ledger(5), db = client(rows);
  const state = { ...progress(rows, 4n), targetTailHash: "e".repeat(64) };
  const result = await verifyAuditHistoryChunk(db, state, 3, hash);
  assert.equal(result.valid, false); assert.equal(result.code, "TARGET_HASH_MISMATCH");
  assert.equal(result.checked, 1);
});

test("invalid persisted progress is rejected before any database read", async () => {
  const rows = ledger(2), db = client(rows);
  const state = { ...progress(rows), verifiedSequence: 0n, verifiedHash: rows[0].hash };
  await assert.rejects(verifyAuditHistoryChunk(db, state, 1, hash),
    error => error.code === "AUDIT_HISTORY_PROGRESS_INVALID");
  assert.equal(db.calls.first, 0); assert.equal(db.calls.pages.length, 0);
});
