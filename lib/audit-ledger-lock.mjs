export async function lockAuditLedger(tx, tenantId) {
  if (typeof tenantId !== "string" || tenantId.length < 1 || tenantId.length > 256) {
    throw new Error("Audit ledger tenant identifier is invalid.");
  }

  // PostgreSQL transaction-scoped advisory lock. A collision only serializes
  // unrelated tenants; it cannot let two writers into the same tenant ledger.
  await tx.$queryRaw`
    WITH acquired AS (
      SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 918273645::bigint))
    )
    SELECT 1::INTEGER AS "locked"
    FROM acquired
  `;
}

export async function appendToAuditLedger(tx, tenantId, writer) {
  if (typeof writer !== "function") throw new Error("Audit ledger writer is required.");
  await lockAuditLedger(tx, tenantId);

  let state = await tx.auditLedgerState.findUnique({
    where: { tenantId },
    select: { tailHash: true, eventCount: true }
  });

  if (!state) {
    const existing = await tx.auditEvent.findFirst({
      where: { tenantId },
      select: { id: true }
    });
    if (existing) {
      throw new Error("Audit ledger state is missing for a non-empty tenant ledger.");
    }
    state = await tx.auditLedgerState.create({
      data: { tenantId, tailHash: null, eventCount: 0n },
      select: { tailHash: true, eventCount: true }
    });
  }

  const reservation = {
    previousHash: state.tailHash,
    ledgerSequence: state.eventCount + 1n
  };
  const result = await writer(reservation);
  if (!result || typeof result.nextHash !== "string" || !/^[a-f0-9]{64}$/.test(result.nextHash)) {
    throw new Error("Audit ledger writer returned an invalid next hash.");
  }

  const advanced = await tx.auditLedgerState.updateMany({
    where: {
      tenantId,
      tailHash: state.tailHash,
      eventCount: state.eventCount
    },
    data: {
      tailHash: result.nextHash,
      eventCount: { increment: 1 }
    }
  });
  if (advanced.count !== 1) {
    throw new Error("Audit ledger tail changed while appending an event.");
  }

  return result.value;
}
