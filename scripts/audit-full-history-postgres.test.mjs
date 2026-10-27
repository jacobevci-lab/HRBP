import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { appendToAuditLedger } from "../lib/audit-ledger-lock.mjs";
import { fullAuditHash, verifyFullAuditHistory } from "./audit-full-history-verification.mjs";

import { createAuditCheckpoint, verifyAuditCheckpoint, compareAuditCheckpoint } from "./audit-checkpoint.mjs";

const enabled = process.env.CI === "true" && process.env.HRBP_DISPOSABLE_AUDIT_LEDGER_TEST === "true";

test("read-only full audit scan covers a real PostgreSQL ledger and detects pre-tail tampering", {
  skip: !enabled
}, async () => {
  const dbUrl = new URL(process.env.DATABASE_URL ?? "about:blank");
  assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname));
  assert.equal(dbUrl.pathname, "/hrbp", "This fixture may only touch the disposable CI database.");

  const db = new PrismaClient();
  const pg = new Client({ connectionString: dbUrl.toString() });
  const tenantId = "ci-full-audit-" + randomUUID();
  try {
    await db.tenant.create({
      data: { id: tenantId, name: "Disposable full audit history verification", region: "test" }
    });
    for (let i = 0; i < 12; i++) {
      await db.$transaction(tx => appendToAuditLedger(tx, tenantId, async ({ previousHash, ledgerSequence }) => {
        const row = {
          tenantId, ledgerSequence, actorId: "system:ci-audit-history",
          action: "audit.synthetic-append", resourceType: "CITest", resourceId: "fixture-" + i,
          purpose: "Disposable audit-history regression", classification: "INTERNAL",
          ipAddress: null, occurredAt: new Date("2026-10-14T12:00:00.000Z")
        };
        const hash = fullAuditHash(row, previousHash);
        await tx.auditEvent.create({ data: { ...row, hash, previousHash } });
        return { nextHash: hash, value: true };
      }));
    }
    await pg.connect();
    const valid = await verifyFullAuditHistory(pg, { tenantId, batchSize: 3, maxEvents: 30 });
    assert.equal(valid.code, "FULL_CHAIN_VERIFIED");
    assert.equal(valid.valid, true);
    assert.equal(valid.eventsChecked, 12);

    // Explicitly corrupt only our throwaway CI tenant. The scheduled tail
    // checker would start at a later predecessor anchor for a large ledger.
    const changed = await db.auditEvent.updateMany({
      where: { tenantId, ledgerSequence: 2n },
      data: { purpose: "Disposable deliberate tamper" }
    });
    assert.equal(changed.count, 1);
    const invalid = await verifyFullAuditHistory(pg, { tenantId, batchSize: 4, maxEvents: 30 });
    assert.equal(invalid.valid, false);
    assert.equal(invalid.code, "EVENT_HASH_MISMATCH");
    assert.equal(invalid.eventsChecked, 1);
  } finally {
    await pg.end().catch(() => {});
    await db.auditEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await db.auditLedgerState.deleteMany({ where: { tenantId } }).catch(() => {});
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await db.$disconnect();
  }
});

test("signed external checkpoint detects a fully rehashed or truncated PostgreSQL history", {
  skip: !enabled, timeout: 60_000
}, async () => {
  const dbUrl = new URL(process.env.DATABASE_URL ?? "about:blank");
  assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname));
  assert.equal(dbUrl.pathname, "/hrbp", "Never mutate a remote/customer database for this regression.");
  const tenantId = "ci-signed-audit-" + randomUUID();
  const db = new PrismaClient(), pg = new Client({ connectionString: dbUrl.toString() });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"); // ephemeral CI-only key
  const scan = { tenantId, maxEvents: 30, batchSize: 2 };
  const context = { deploymentId: "disposable-postgres-ci" };
  async function append(index) {
    return db.$transaction(tx => appendToAuditLedger(tx, tenantId, async ({ previousHash, ledgerSequence }) => {
      const row = { tenantId, ledgerSequence, actorId: "system:ci-checkpoint",
        action: "audit.synthetic", resourceType: "CITest", resourceId: "synthetic-" + index,
        purpose: "Disposable signed checkpoint regression", classification: "INTERNAL",
        ipAddress: null, occurredAt: new Date("2026-10-14T12:00:00Z") };
      const hash = fullAuditHash(row, previousHash);
      await tx.auditEvent.create({ data: { ...row, hash, previousHash } });
      return { nextHash: hash, value: true };
    }));
  }
  try {
    await db.tenant.create({ data: { id: tenantId, name: "Synthetic signed audit", region: "test" } });
    for (let i = 0; i < 5; i++) await append(i);
    await pg.connect();
    const checkpoint = await createAuditCheckpoint(pg, scan, privateKey, context);
    const trust = { ...context, tenantId, publicKey, maxAgeMs: 3600_000, minSequence: "5" };
    assert.equal(verifyAuditCheckpoint(checkpoint, trust).sequence, "5");
    assert.equal((await compareAuditCheckpoint(pg, scan, checkpoint, trust)).valid, true);
    await append(5);
    const appended = await compareAuditCheckpoint(pg, scan, checkpoint, trust);
    assert.equal(appended.valid, true); assert.equal(appended.eventsChecked, 6);

    // Only this explicitly gated synthetic tenant is modified. Recompute every
    // hash AND its head to simulate a database-privileged rewrite that looks
    // internally consistent; the retained checkpoint is outside that database.
    await db.$transaction(async tx => {
      const rows = await tx.auditEvent.findMany({ where: { tenantId }, orderBy: { ledgerSequence: "asc" } });
      let previousHash = null;
      for (const row of rows) {
        const purpose = row.ledgerSequence === 2n ? "Synthetic malicious rewrite" : row.purpose;
        const hash = fullAuditHash({ ...row, purpose }, previousHash);
        const changed = await tx.auditEvent.updateMany({ where: { id: row.id, tenantId }, data: { purpose, previousHash, hash } });
        assert.equal(changed.count, 1); previousHash = hash;
      }
      await tx.auditLedgerState.update({ where: { tenantId }, data: { tailHash: previousHash } });
    });
    assert.equal((await verifyFullAuditHistory(pg, scan)).valid, true);
    const rewritten = await compareAuditCheckpoint(pg, scan, checkpoint, trust);
    assert.equal(rewritten.valid, false); assert.equal(rewritten.code, "CHECKPOINT_HASH_MISMATCH");

    await db.$transaction(async tx => {
      const retained = await tx.auditEvent.findFirst({ where: { tenantId, ledgerSequence: 3n } });
      await tx.auditEvent.deleteMany({ where: { tenantId, ledgerSequence: { gt: 3n } } });
      await tx.auditLedgerState.update({ where: { tenantId }, data: { eventCount: 3n, tailHash: retained.hash } });
    });
    assert.equal((await verifyFullAuditHistory(pg, scan)).valid, true);
    const truncated = await compareAuditCheckpoint(pg, scan, checkpoint, trust);
    assert.equal(truncated.valid, false); assert.equal(truncated.code, "CHECKPOINT_SEQUENCE_MISSING");
    // A checkpoint signature does not turn a changed database into a good one.
    assert.equal(verifyAuditCheckpoint(checkpoint, trust).sequence, "5");
  } finally {
    await pg.end().catch(() => {});
    await db.auditEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await db.auditLedgerState.deleteMany({ where: { tenantId } }).catch(() => {});
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await db.$disconnect();
  }
});
