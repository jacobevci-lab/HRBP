import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { appendToAuditLedger } from "../lib/audit-ledger-lock.mjs";
import { fullAuditHash, verifyFullAuditHistory } from "./audit-full-history-verification.mjs";
import { createAuditCheckpoint, compareAuditCheckpoint, verifyAuditCheckpoint } from "./audit-checkpoint.mjs";

const enabled = process.env.CI === "true" && process.env.HRBP_DISPOSABLE_AUDIT_LEDGER_TEST === "true";
const TENANTS = 8;
const CHECKPOINT_EVENTS = 24;
const FINAL_EVENTS = 32;

function assertDisposableDatabase() {
  const dbUrl = new URL(process.env.DATABASE_URL ?? "about:blank");
  assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname));
  assert.equal(dbUrl.pathname, "/hrbp", "This rehearsal may only touch the disposable CI database.");
  return dbUrl;
}

async function appendSynthetic(db, tenantId, index) {
  return db.$transaction(tx => appendToAuditLedger(tx, tenantId, async ({ previousHash, ledgerSequence }) => {
    const row = {
      tenantId,
      ledgerSequence,
      actorId: "system:ci-assurance",
      action: "audit.assurance-rehearsal",
      resourceType: "CITest",
      resourceId: "assurance-" + index,
      purpose: "Disposable multi-tenant assurance rehearsal",
      classification: "INTERNAL",
      ipAddress: null,
      occurredAt: new Date("2026-10-27T00:00:00.000Z")
    };
    const hash = fullAuditHash(row, previousHash);
    await tx.auditEvent.create({ data: { ...row, hash, previousHash } });
    return { nextHash: hash, value: true };
  }));
}

async function snapshotTenant(db, tenantId) {
  const [events, ledger] = await Promise.all([
    db.auditEvent.findMany({ where: { tenantId }, orderBy: { ledgerSequence: "asc" } }),
    db.auditLedgerState.findUniqueOrThrow({ where: { tenantId } })
  ]);
  return {
    events: events.map(row => ({
      id: row.id,
      tenantId: row.tenantId,
      ledgerSequence: row.ledgerSequence,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      purpose: row.purpose,
      classification: row.classification,
      ipAddress: row.ipAddress,
      occurredAt: row.occurredAt,
      previousHash: row.previousHash,
      hash: row.hash
    })),
    ledger: {
      tenantId: ledger.tenantId,
      eventCount: ledger.eventCount,
      tailHash: ledger.tailHash
    }
  };
}

async function fullyRehashTenant(db, tenantId) {
  await db.$transaction(async tx => {
    const rows = await tx.auditEvent.findMany({ where: { tenantId }, orderBy: { ledgerSequence: "asc" } });
    let previousHash = null;
    for (const row of rows) {
      const purpose = row.ledgerSequence === 2n
        ? "Disposable privileged rewrite"
        : row.purpose;
      const hash = fullAuditHash({ ...row, purpose }, previousHash);
      const changed = await tx.auditEvent.updateMany({
        where: { id: row.id, tenantId },
        data: { purpose, previousHash, hash }
      });
      assert.equal(changed.count, 1);
      previousHash = hash;
    }
    await tx.auditLedgerState.update({
      where: { tenantId },
      data: { eventCount: BigInt(rows.length), tailHash: previousHash }
    });
  });
}

async function truncateTenant(db, tenantId, sequence) {
  await db.$transaction(async tx => {
    const retained = await tx.auditEvent.findFirstOrThrow({
      where: { tenantId, ledgerSequence: BigInt(sequence) }
    });
    await tx.auditEvent.deleteMany({
      where: { tenantId, ledgerSequence: { gt: BigInt(sequence) } }
    });
    await tx.auditLedgerState.update({
      where: { tenantId },
      data: { eventCount: BigInt(sequence), tailHash: retained.hash }
    });
  });
}

async function restoreExactTenant(db, snapshot) {
  const { tenantId } = snapshot.ledger;
  await db.$transaction(async tx => {
    await tx.auditEvent.deleteMany({ where: { tenantId } });
    for (const row of snapshot.events) {
      await tx.auditEvent.create({ data: row });
    }
    await tx.auditLedgerState.update({
      where: { tenantId },
      data: {
        eventCount: snapshot.ledger.eventCount,
        tailHash: snapshot.ledger.tailHash
      }
    });
  });
}

test("multi-tenant assurance rehearsal detects rewrite/truncation and accepts exact restore", {
  skip: !enabled,
  timeout: 120_000
}, async () => {
  const dbUrl = assertDisposableDatabase();
  const db = new PrismaClient();
  const pg = new Client({ connectionString: dbUrl.toString() });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const runId = randomUUID();
  const tenants = Array.from({ length: TENANTS }, (_, index) => ({
    id: `ci-assurance-${runId}-${index}`,
    name: `Disposable assurance tenant ${index + 1}`
  }));
  const deploymentId = "disposable-multitenant-assurance";
  const checkpoints = new Map();
  const originalSnapshots = new Map();
  const summary = {
    tenantCount: TENANTS,
    checkpointEventsPerTenant: CHECKPOINT_EVENTS,
    finalEventsPerTenant: FINAL_EVENTS,
    baselineVerified: 0,
    appendedVerified: 0,
    rewriteDetected: 0,
    truncationDetected: 0,
    restoredVerified: 0
  };

  try {
    for (const tenant of tenants) {
      await db.tenant.create({ data: { id: tenant.id, name: tenant.name, region: "test" } });
      for (let index = 0; index < CHECKPOINT_EVENTS; index++) {
        await appendSynthetic(db, tenant.id, index);
      }
    }

    await pg.connect();

    for (const tenant of tenants) {
      const scan = { tenantId: tenant.id, maxEvents: 64, batchSize: 7 };
      const checkpoint = await createAuditCheckpoint(pg, scan, privateKey, { deploymentId });
      const trust = {
        tenantId: tenant.id,
        deploymentId,
        publicKey,
        maxAgeMs: 3600_000,
        minSequence: String(CHECKPOINT_EVENTS)
      };
      assert.equal(verifyAuditCheckpoint(checkpoint, trust).sequence, String(CHECKPOINT_EVENTS));
      const baseline = await compareAuditCheckpoint(pg, scan, checkpoint, trust);
      assert.equal(baseline.valid, true);
      assert.equal(baseline.complete, true);
      assert.equal(baseline.eventsChecked, CHECKPOINT_EVENTS);
      checkpoints.set(tenant.id, { checkpoint, trust, scan });
      summary.baselineVerified += 1;
    }

    for (const tenant of tenants) {
      for (let index = CHECKPOINT_EVENTS; index < FINAL_EVENTS; index++) {
        await appendSynthetic(db, tenant.id, index);
      }
      const { checkpoint, trust, scan } = checkpoints.get(tenant.id);
      const appended = await compareAuditCheckpoint(pg, scan, checkpoint, trust);
      assert.equal(appended.valid, true);
      assert.equal(appended.complete, true);
      assert.equal(appended.eventsChecked, FINAL_EVENTS);
      summary.appendedVerified += 1;
      originalSnapshots.set(tenant.id, await snapshotTenant(db, tenant.id));
    }

    // Tenant 0: privileged rewrite with every hash/head recomputed. Fresh scan is
    // internally valid; retained off-database checkpoint must still catch it.
    const rewrittenTenant = tenants[0].id;
    await fullyRehashTenant(db, rewrittenTenant);
    const rewrittenFresh = await verifyFullAuditHistory(pg, checkpoints.get(rewrittenTenant).scan);
    assert.equal(rewrittenFresh.valid, true);
    assert.equal(rewrittenFresh.complete, true);
    const rewrittenAnchored = await compareAuditCheckpoint(
      pg,
      checkpoints.get(rewrittenTenant).scan,
      checkpoints.get(rewrittenTenant).checkpoint,
      checkpoints.get(rewrittenTenant).trust
    );
    assert.equal(rewrittenAnchored.valid, false);
    assert.equal(rewrittenAnchored.code, "CHECKPOINT_HASH_MISMATCH");
    summary.rewriteDetected += 1;

    // Tenant 1: internally consistent truncation below retained checkpoint.
    const truncatedTenant = tenants[1].id;
    await truncateTenant(db, truncatedTenant, 16);
    const truncatedFresh = await verifyFullAuditHistory(pg, checkpoints.get(truncatedTenant).scan);
    assert.equal(truncatedFresh.valid, true);
    assert.equal(truncatedFresh.complete, true);
    const truncatedAnchored = await compareAuditCheckpoint(
      pg,
      checkpoints.get(truncatedTenant).scan,
      checkpoints.get(truncatedTenant).checkpoint,
      checkpoints.get(truncatedTenant).trust
    );
    assert.equal(truncatedAnchored.valid, false);
    assert.equal(truncatedAnchored.code, "CHECKPOINT_SEQUENCE_MISSING");
    summary.truncationDetected += 1;

    // Restore the exact known-good snapshots and require the retained checkpoints
    // to become valid again. This is a disposable forensic recovery rehearsal,
    // not automated production repair.
    for (const tenantId of [rewrittenTenant, truncatedTenant]) {
      await restoreExactTenant(db, originalSnapshots.get(tenantId));
      const { checkpoint, trust, scan } = checkpoints.get(tenantId);
      const restoredFresh = await verifyFullAuditHistory(pg, scan);
      assert.equal(restoredFresh.valid, true);
      assert.equal(restoredFresh.eventsChecked, FINAL_EVENTS);
      const restoredAnchored = await compareAuditCheckpoint(pg, scan, checkpoint, trust);
      assert.equal(restoredAnchored.valid, true);
      assert.equal(restoredAnchored.eventsChecked, FINAL_EVENTS);
      summary.restoredVerified += 1;
    }

    assert.deepEqual(summary, {
      tenantCount: 8,
      checkpointEventsPerTenant: 24,
      finalEventsPerTenant: 32,
      baselineVerified: 8,
      appendedVerified: 8,
      rewriteDetected: 1,
      truncationDetected: 1,
      restoredVerified: 2
    });
    const serialized = JSON.stringify(summary);
    for (const tenant of tenants) assert.ok(!serialized.includes(tenant.id));
    assert.ok(!serialized.includes(runId));
    console.log("AUDIT_ASSURANCE_REHEARSAL " + serialized);
  } finally {
    await pg.end().catch(() => {});
    for (const tenant of tenants) {
      await db.auditEvent.deleteMany({ where: { tenantId: tenant.id } }).catch(() => {});
      await db.auditLedgerState.deleteMany({ where: { tenantId: tenant.id } }).catch(() => {});
      await db.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => {});
    }
    await db.$disconnect();
  }
});
