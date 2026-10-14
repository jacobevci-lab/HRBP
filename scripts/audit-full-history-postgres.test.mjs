import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { appendToAuditLedger } from "../lib/audit-ledger-lock.mjs";
import { fullAuditHash, verifyFullAuditHistory } from "./audit-full-history-verification.mjs";

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
