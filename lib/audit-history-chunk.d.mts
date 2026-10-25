import type { DataClassification } from "@prisma/client";

export type AuditHistoryChunkProgress = {
  tenantId: string;
  scanVersion: number;
  scheduleVersion: number;
  status: "RUNNING";
  targetSequence: bigint;
  targetTailHash: string | null;
  verifiedSequence: bigint;
  verifiedHash: string | null;
};

export type AuditHistoryHashInput = {
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  purpose: string | null;
  classification: DataClassification;
  ipAddress: string | null;
  occurredAt: Date;
};

export type AuditHistoryEventRow = AuditHistoryHashInput & {
  ledgerSequence: bigint;
  hash: string;
  previousHash: string | null;
};

export type AuditHistoryChunkResult = {
  valid: boolean;
  complete: boolean;
  code: string;
  checked: number;
  nextSequence: bigint;
  nextHash: string | null;
};

export declare function validateAuditHistoryProgress(progress: AuditHistoryChunkProgress): {
  targetSequence: bigint;
  verifiedSequence: bigint;
};

export declare function verifyAuditHistoryChunk(
  client: {
    auditEvent: {
      findFirst(args: {
        where: { tenantId: string; ledgerSequence: bigint };
        select: { hash: true };
      }): Promise<{ hash: string } | null>;
      findMany(args: {
        where: {
          tenantId: string;
          ledgerSequence: { gt: bigint; lte: bigint };
        };
        orderBy: { ledgerSequence: "asc" };
        take: number;
        select: {
          tenantId: true;
          ledgerSequence: true;
          actorId: true;
          action: true;
          resourceType: true;
          resourceId: true;
          purpose: true;
          classification: true;
          ipAddress: true;
          occurredAt: true;
          hash: true;
          previousHash: true;
        };
      }): Promise<AuditHistoryEventRow[]>;
    };
  },
  progress: AuditHistoryChunkProgress,
  pageSize: number,
  computeHash: (event: AuditHistoryHashInput, previousHash: string | null) => string
): Promise<AuditHistoryChunkResult>;
