/**
 * Select a bounded, deterministic audit-verification tenant window per
 * scheduled 15-minute invocation. This is best-effort rotation, not a durable
 * checkpoint: missed invocations must be monitored and compensated explicitly.
 */
export function selectAuditIntegrityBatch({
  now,
  tenantCount,
  requestedTenantBatchSize,
  verificationLimit
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError("Invalid audit monitoring timestamp.");
  if (!Number.isSafeInteger(tenantCount) || tenantCount < 0) throw new RangeError("Invalid audit tenant count.");
  if (!Number.isInteger(verificationLimit) || verificationLimit < 10 || verificationLimit > 5000) {
    throw new RangeError("Invalid audit verification limit.");
  }
  if (!Number.isFinite(requestedTenantBatchSize)) throw new RangeError("Invalid audit tenant batch size.");

  const requested = Math.max(1, Math.min(25, Math.floor(requestedTenantBatchSize)));
  // At most 10,000 audit events across selected tenants, plus one anchor
  // per tenant. This bounds Worker CPU/hash checks independently of tenant count.
  const maxTenantsByEventBudget = Math.max(1, Math.floor(10_000 / verificationLimit));
  const tenantBatchSize = Math.min(requested, maxTenantsByEventBudget);
  const batchCount = Math.max(1, Math.ceil(tenantCount / tenantBatchSize));
  const quarterHourSlot = Math.floor(now.getTime() / (15 * 60 * 1000));
  const batchIndex = quarterHourSlot % batchCount;

  return {
    tenantBatchSize,
    batchCount,
    batchIndex,
    skip: batchIndex * tenantBatchSize,
    take: tenantBatchSize,
    quarterHourSlot,
    maxVerificationEvents: tenantBatchSize * verificationLimit
  };
}
