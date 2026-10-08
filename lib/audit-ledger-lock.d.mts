import type { Prisma } from "@prisma/client";

export type AuditLedgerReservation = {
  previousHash: string | null;
  ledgerSequence: bigint;
};

export function lockAuditLedger(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<void>;

export function appendToAuditLedger<T>(
  tx: Prisma.TransactionClient,
  tenantId: string,
  writer: (reservation: AuditLedgerReservation) => Promise<{ nextHash: string; value: T }>
): Promise<T>;
