import type { Prisma } from "@prisma/client";

/**
 * Serializes identity-provider lifecycle transitions per tenant across all
 * application instances. The namespace salt is intentionally distinct from
 * SCIM provisioning and audit-ledger locks.
 */
export async function lockIdentityProviderTenant(tx: Prisma.TransactionClient, tenantId: string) {
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(tenantId)) {
    throw new Error("Identity-provider tenant identifier is invalid.");
  }
  await tx.$queryRaw`WITH acquired AS (
    SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 61977431::bigint))
  ) SELECT 1::INTEGER AS "locked" FROM acquired`;
}
