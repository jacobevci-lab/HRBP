import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { appendToAuditLedger } from "../lib/audit-ledger-lock.mjs";

const enabled = process.env.HRBP_DISPOSABLE_AUDIT_LEDGER_TEST === "true";

function computeHash({ tenantId, actorId, action, resourceType, resourceId, purpose, classification, ipAddress, occurredAt }, previousHash) {
  const payload = JSON.stringify({
    tenantId,
    actorId,
    action,
    resourceType,
    resourceId,
    purpose,
    classification,
    ipAddress,
    occurredAt: occurredAt.toISOString()
  });
  return createHash("sha256").update(`${previousHash ?? "GENESIS"}|${payload}`).digest("hex");
}

test("concurrent audit writers serialize into one contiguous tenant ledger", { skip: !enabled }, async () => {
  const db = new PrismaClient();
  const tenantId = "ci-audit-ledger-concurrency";
  const writerCount = 24;

  try {
    await db.auditLedgerState.deleteMany({ where: { tenantId } });
    await db.auditEvent.deleteMany({ where: { tenantId } });
    await db.tenant.upsert({
      where: { id: tenantId },
      update: { name: "CI Audit Ledger Tenant", region: "test" },
      create: { id: tenantId, name: "CI Audit Ledger Tenant", region: "test" }
    });

    await Promise.all(Array.from({ length: writerCount }, (_, index) =>
      db.$transaction(async (tx) => {
        return appendToAuditLedger(tx, tenantId, async ({ previousHash, ledgerSequence }) => {
          const occurredAt = new Date();
          const input = {
            tenantId,
            actorId: `ci-writer-${index}`,
            action: "audit.concurrent-test",
            resourceType: "CITest",
            resourceId: `resource-${index}`,
            purpose: "Verify serialized audit ledger appends",
            classification: "INTERNAL",
            ipAddress: null,
            occurredAt
          };
          const hash = computeHash(input, previousHash);
          const event = await tx.auditEvent.create({
            data: {
              tenantId,
              ledgerSequence,
              actorId: input.actorId,
              action: input.action,
              resourceType: input.resourceType,
              resourceId: input.resourceId,
              purpose: input.purpose,
              classification: input.classification,
              ipAddress: input.ipAddress,
              occurredAt,
              hash,
              previousHash
            }
          });
          return { nextHash: hash, value: event };
        });
      }, { maxWait: 20_000, timeout: 30_000 })
    ));

    const events = await db.auditEvent.findMany({
      where: { tenantId },
      orderBy: { ledgerSequence: "asc" }
    });
    const state = await db.auditLedgerState.findUnique({ where: { tenantId } });

    assert.equal(events.length, writerCount);
    assert.ok(state);
    assert.equal(state.eventCount, BigInt(writerCount));
    assert.equal(state.tailHash, events.at(-1)?.hash ?? null);

    let previousHash = null;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      assert.equal(event.ledgerSequence, BigInt(index + 1));
      assert.equal(event.previousHash, previousHash);
      assert.equal(computeHash({
        tenantId: event.tenantId,
        actorId: event.actorId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        purpose: event.purpose,
        classification: event.classification,
        ipAddress: event.ipAddress,
        occurredAt: event.occurredAt
      }, event.previousHash), event.hash);
      previousHash = event.hash;
    }

    const predecessor = events.at(-2)?.hash;
    assert.ok(predecessor);
    await assert.rejects(
      db.auditEvent.create({
        data: {
          tenantId,
          ledgerSequence: BigInt(writerCount + 1),
          actorId: "ci-fork-writer",
          action: "audit.concurrent-fork",
          resourceType: "CITest",
          resourceId: "fork",
          purpose: "Verify fork rejection",
          classification: "INTERNAL",
          occurredAt: new Date(),
          hash: createHash("sha256").update("ci-fork").digest("hex"),
          previousHash: predecessor
        }
      })
    );

    assert.equal(await db.auditEvent.count({ where: { tenantId } }), writerCount);
  } finally {
    await db.auditLedgerState.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.auditEvent.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    await db.$disconnect();
  }
});
