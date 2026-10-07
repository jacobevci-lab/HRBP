import type { Prisma } from "@prisma/client";

export function lockAuditLedger(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<void>;
