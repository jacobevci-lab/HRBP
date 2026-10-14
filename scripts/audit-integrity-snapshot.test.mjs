import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const TENANT = "tenant-a";
const DATE = new Date("2026-10-14T12:00:00.000Z");

function computeAuditHash(input, previousHash) {
  const payload = JSON.stringify({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    purpose: input.purpose,
    classification: input.classification,
    ipAddress: input.ipAddress,
    occurredAt: input.occurredAt.toISOString()
  });
  return createHash("sha256").update((previousHash ?? "GENESIS") + "|" + payload).digest("hex");
}

function chain(count) {
  const rows = [];
  let previousHash = null;
  for (let i = 1; i <= count; i++) {
    const row = {
      id: "event-" + i, tenantId: TENANT, ledgerSequence: BigInt(i),
      actorId: "worker-a", action: "audit.integration-check",
      resourceType: "CITest", resourceId: "resource-" + i,
      purpose: "Verify stable ledger reads", classification: "INTERNAL",
      ipAddress: null, occurredAt: DATE, previousHash
    };
    row.hash = computeAuditHash(row, previousHash);
    rows.push(row);
    previousHash = row.hash;
  }
  const state = count ? { eventCount: BigInt(count), tailHash: previousHash } : null;
  return { state, rows };
}

function harness({ state, rows, throwTransaction = false }) {
  const calls = { ledgerQuery: [], eventQuery: [], transactions: [] };
  const db = {
    // The production db compatibility proxy does not bind top-level delegates
    // to the transaction. Any use outside tx is a correctness regression.
    auditLedgerState: {
      findUnique: () => { throw new Error("QUERY_OUTSIDE_TRANSACTION"); }
    },
    auditEvent: {
      findMany: () => { throw new Error("QUERY_OUTSIDE_TRANSACTION"); }
    },
    $transaction: async (operation, options) => {
      calls.transactions.push({ options });
      assert.equal(typeof operation, "function", "must pass an interactive tx callback, not eager query promises");
      assert.equal(options.isolationLevel, "RepeatableRead");
      if (throwTransaction) throw new Error("CONSISTENT_READ_UNAVAILABLE");
      const tx = {
        auditLedgerState: {
          findUnique: async args => {
            calls.ledgerQuery.push(args);
            return state;
          }
        },
        auditEvent: {
          findMany: async args => {
            calls.eventQuery.push(args);
            return rows.slice(-args.take).reverse();
          }
        }
      };
      return operation(tx);
    }
  };

  const path = "lib/audit-integrity.ts";
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const mocks = {
    "@prisma/client": { Prisma: { TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" } } },
    "@/lib/db": { db },
    "@/lib/audit": { computeAuditHash }
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (!(name in mocks)) throw new Error("Unexpected dependency: " + name);
    return mocks[name];
  });

  return { calls, verify: module.exports.verifyAuditIntegrity };
}

test("genesis audit chain verifies using one repeatable-read snapshot, not independent queries", async () => {
  const h = harness(chain(3));
  const outcome = await h.verify(TENANT, 10);
  assert.equal(outcome.valid, true);
  assert.equal(outcome.scope, "GENESIS");
  assert.equal(outcome.checked, 3);
  assert.equal(outcome.verifiedThroughSequence, "3");
  assert.equal(outcome.brokenEventId, null);
  assert.equal(h.calls.transactions.length, 1);
  assert.equal(h.calls.ledgerQuery.length, 1);
  assert.equal(h.calls.eventQuery.length, 1);
  assert.deepEqual(h.calls.ledgerQuery[0], {
    where: { tenantId: TENANT }, select: { tailHash: true, eventCount: true }
  });
  assert.equal(h.calls.eventQuery[0].where.tenantId, TENANT);
  assert.equal(h.calls.eventQuery[0].take, 11);
  assert.deepEqual(h.calls.eventQuery[0].orderBy, [{ ledgerSequence: "desc" }]);
});

test("valid tail verifies a predecessor anchor and exact persisted head", async () => {
  const h = harness(chain(12));
  const outcome = await h.verify(TENANT, 10);
  assert.equal(outcome.valid, true);
  assert.equal(outcome.scope, "TAIL");
  assert.equal(outcome.checked, 10);
  assert.equal(outcome.verifiedThroughSequence, "12");
  assert.equal(outcome.firstEventId, "event-3");
  assert.equal(outcome.lastEventId, "event-12");
});

test("a stable snapshot remains valid even if another writer has just appended to the database", async () => {
  // In PostgreSQL Repeatable Read, an append committed between two SELECTs
  // is invisible to the shared transaction snapshot, not a false corruption.
  const firstSnapshot = chain(1);
  const h = harness(firstSnapshot);
  const newerCommittedState = chain(2);
  assert.notEqual(newerCommittedState.state.tailHash, firstSnapshot.state.tailHash);
  const outcome = await h.verify(TENANT, 10);
  assert.equal(outcome.valid, true);
  assert.equal(outcome.checked, 1);
  assert.equal(h.calls.transactions[0].options.isolationLevel, "RepeatableRead");
});

test("empty ledger is only valid with empty ledger state", async () => {
  for (const state of [null, { eventCount: BigInt(0), tailHash: null }]) {
    const h = harness({ state, rows: [] });
    const result = await h.verify(TENANT);
    assert.equal(result.scope, "EMPTY");
    assert.equal(result.valid, true);
    assert.equal(result.checked, 0);
    assert.equal(result.verifiedThroughSequence, "0");
  }
  const inconsistent = harness({
    state: { eventCount: BigInt(2), tailHash: "sha256-not-zero" },
    rows: []
  });
  const result = await inconsistent.verify(TENANT);
  assert.equal(result.scope, "EMPTY");
  assert.equal(result.valid, false);
  assert.equal(result.verifiedThroughSequence, null);
  assert.match(result.reason, /non-empty/);
});

test("missing state, altered hashes and forged ledger tail are still detected", async () => {
  const original = chain(2);
  const missingState = harness({ state: null, rows: original.rows });
  const missing = await missingState.verify(TENANT);
  assert.equal(missing.valid, false);
  assert.match(missing.reason, /missing/);

  const forgedRows = structuredClone(original.rows);
  forgedRows[1].hash = "a".repeat(64);
  const forgedHash = harness({ state: original.state, rows: forgedRows });
  const broken = await forgedHash.verify(TENANT);
  assert.equal(broken.valid, false);
  assert.equal(broken.verifiedThroughSequence, null);
  assert.equal(broken.brokenEventId, "event-2");

  const forgedTail = harness({
    state: { tailHash: "b".repeat(64), eventCount: BigInt(2) },
    rows: original.rows
  });
  const tail = await forgedTail.verify(TENANT);
  assert.equal(tail.valid, false);
  assert.match(tail.reason, /persisted chain tail/);
});

test("failed repeatable-read snapshot must fail closed rather than mark audit healthy", async () => {
  const h = harness({ ...chain(1), throwTransaction: true });
  await assert.rejects(h.verify(TENANT), /CONSISTENT_READ_UNAVAILABLE/);
  assert.equal(h.calls.transactions.length, 1);
});

test("verifier retains 10-5000 event cap and never leaks another tenant", async () => {
  const h = harness(chain(1));
  await h.verify(TENANT, 99_999);
  assert.equal(h.calls.eventQuery[0].take, 5_001);
  assert.equal(h.calls.eventQuery[0].where.tenantId, TENANT);
  assert.equal(h.calls.ledgerQuery[0].where.tenantId, TENANT);
});

test("static audit integrity contract explicitly requires a consistent read", () => {
  const source = readFileSync("lib/audit-integrity.ts", "utf8");
  assert.match(source, /db\.\$transaction\(async \(tx\) =>/);
  assert.match(source, /await tx\.auditLedgerState\.findUnique/);
  assert.match(source, /await tx\.auditEvent\.findMany/);
  assert.doesNotMatch(source, /db\.auditEvent\.findMany/);
  assert.match(source, /isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead/);
  assert.doesNotMatch(source, /const \[state, rows\] = await Promise\.all/);
});
