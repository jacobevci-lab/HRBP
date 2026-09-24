import { db } from "@/lib/db";
import { computeAuditHash } from "@/lib/audit";

export type AuditIntegrityResult = {
  checked: number;
  valid: boolean;
  scope: "GENESIS" | "TAIL" | "EMPTY";
  firstEventId: string | null;
  lastEventId: string | null;
  brokenEventId: string | null;
  reason: string | null;
  generatedAt: string;
};

export async function verifyAuditIntegrity(tenantId: string, requestedLimit = 1000): Promise<AuditIntegrityResult> {
  const limit = Math.min(5000, Math.max(10, Math.floor(requestedLimit)));
  const rows = await db.auditEvent.findMany({
    where: { tenantId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      tenantId: true,
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

  if (!rows.length) {
    return {
      checked: 0,
      valid: true,
      scope: "EMPTY",
      firstEventId: null,
      lastEventId: null,
      brokenEventId: null,
      reason: null,
      generatedAt: new Date().toISOString()
    };
  }

  const hasPredecessorAnchor = rows.length > limit;
  const chronological = rows.reverse();
  const verificationRows = hasPredecessorAnchor ? chronological.slice(1) : chronological;
  let previousHash = hasPredecessorAnchor ? chronological[0]?.hash ?? null : null;
  let brokenEventId: string | null = null;
  let reason: string | null = null;

  for (const row of verificationRows) {
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
    previousHash = row.hash;
  }

  return {
    checked: verificationRows.length,
    valid: brokenEventId === null,
    scope: hasPredecessorAnchor ? "TAIL" : "GENESIS",
    firstEventId: verificationRows[0]?.id ?? null,
    lastEventId: verificationRows.at(-1)?.id ?? null,
    brokenEventId,
    reason,
    generatedAt: new Date().toISOString()
  };
}
