export async function lockAuditLedger(tx, tenantId) {
  if (typeof tenantId !== "string" || tenantId.length < 1 || tenantId.length > 256) {
    throw new Error("Audit ledger tenant identifier is invalid.");
  }

  // PostgreSQL transaction-scoped advisory lock. A collision only serializes
  // unrelated tenants; it cannot let two writers into the same tenant ledger.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 918273645::bigint))
  `;
}
