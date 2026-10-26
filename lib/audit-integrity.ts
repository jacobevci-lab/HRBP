import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeAuditHash } from "@/lib/audit";

export type AuditIntegrityResult = {
  checked: number;
  valid: boolean;
  // Highest confirmed chain sequence for this exact MVCC snapshot; nullable on failure.
  // A TAIL scope does not attest genesis-to-tail completeness.
  verifiedThroughSequence: string | null;
  scope: "GENESIS" | "TAIL" | "EMPTY";
  firstEventId: string | null;
  lastEventId: string | null;
  brokenEventId: string | null;
  reason: string | null;
  generatedAt: string;
};

export async function verifyAuditIntegrity(tenantId: string, requestedLimit = 1000): Promise<AuditIntegrityResult> {
  const limit = Math.min(5000, Math.max(10, Math.floor(requestedLimit)));
  // Read the ledger tail state and event rows in one PostgreSQL MVCC
  // snapshot. Independent read-committed statements can otherwise straddle
  // a concurrent append and falsely report corruption for a healthy ledger.
  // The database compatibility layer creates a separate client for every
  // top-level delegate call. Use the transaction-scoped tx delegates, never
  // a Prisma batch of eagerly executed db.<delegate> promises.
  const [state, rows] = await db.$transaction(async (tx) => {
    const state = await tx.auditLedgerState.findUnique({
      where: { tenantId },
      select: { tailHash: true, eventCount: true }
    });
    const rows = await tx.auditEvent.findMany({
      where: { tenantId },
      orderBy: [{ ledgerSequence: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        tenantId: true,
        ledgerSequence: true,
        actorId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        purpose: true,
        classification: true,
        ipAddress: true,
        occurredAt: true,
        hash: true,
        previousHash: true
      }
    });
    return [state, rows] as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  if (!rows.length) {
    const emptyStateValid = !state || (state.eventCount === BigInt(0) && state.tailHash === null);
    return {
      checked: 0,
      valid: emptyStateValid,
      verifiedThroughSequence: emptyStateValid ? "0" : null,
      scope: "EMPTY",
      firstEventId: null,
      lastEventId: null,
      brokenEventId: null,
      reason: emptyStateValid ? null : "Audit ledger state is non-empty while no audit events exist.",
      generatedAt: new Date().toISOString()
    };
  }

  if (!state) {
    return {
      checked: 0,
      valid: false,
      verifiedThroughSequence: null,
      scope: rows.length > limit ? "TAIL" : "GENESIS",
      firstEventId: null,
      lastEventId: null,
      brokenEventId: rows.at(-1)?.id ?? null,
      reason: "Audit ledger state is missing for a non-empty tenant ledger.",
      generatedAt: new Date().toISOString()
    };
  }

  const hasPredecessorAnchor = rows.length > limit;
  const chronological = rows.reverse();
  const anchor = hasPredecessorAnchor ? chronological[0] : null;
  const verificationRows = hasPredecessorAnchor ? chronological.slice(1) : chronological;
  let previousHash = anchor?.hash ?? null;
  let expectedSequence = anchor ? anchor.ledgerSequence + BigInt(1) : BigInt(1);
  let brokenEventId: string | null = null;
  let reason: string | null = null;
  let checked = 0;

  for (const row of verificationRows) {
    if (row.ledgerSequence !== expectedSequence) {
      brokenEventId = row.id;
      reason = "Audit ledger sequence is not contiguous.";
      break;
    }
    if (row.previousHash !== previousHash) {
      brokenEventId = row.id;
      reason = "Stored previousHash does not match the preceding audit event hash.";
      break;
    }
    const computed = computeAuditHash({
      tenantId: row.tenantId,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      purpose: row.purpose,
      classification: row.classification,
      ipAddress: row.ipAddress,
      occurredAt: row.occurredAt
    }, row.previousHash);
    if (computed !== row.hash) {
      brokenEventId = row.id;
      reason = "Stored audit hash does not match the recomputed event hash.";
      break;
    }

    checked += 1;
    previousHash = row.hash;
    expectedSequence += BigInt(1);
  }

  if (!brokenEventId) {
    const tail = verificationRows.at(-1);
    if (!tail || tail.hash !== state.tailHash || tail.ledgerSequence !== state.eventCount) {
      brokenEventId = tail?.id ?? anchor?.id ?? null;
      reason = "Audit ledger state does not match the persisted chain tail.";
    }
  }

  return {
    checked,
    valid: brokenEventId === null,
    verifiedThroughSequence: brokenEventId === null ? state.eventCount.toString() : null,
    scope: hasPredecessorAnchor ? "TAIL" : "GENESIS",
    firstEventId: verificationRows[0]?.id ?? null,
    lastEventId: verificationRows.at(-1)?.id ?? null,
    brokenEventId,
    reason,
    generatedAt: new Date().toISOString()
  };
}
