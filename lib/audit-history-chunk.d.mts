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
export type AuditHistoryChunkResult = {
  valid: boolean;
  complete: boolean;
  code: string;
  checked: number;
  nextSequence: bigint;
  nextHash: string | null;
};
export declare function validateAuditHistoryProgress(progress: AuditHistoryChunkProgress): {
  targetSequence: bigint; verifiedSequence: bigint;
};
export declare function verifyAuditHistoryChunk(
  client: { auditEvent: { findFirst(args: unknown): Promise<{ hash: string } | null>; findMany(args: unknown): Promise<any[]> } },
  progress: AuditHistoryChunkProgress,
  pageSize: number,
  computeHash: (event: any, previousHash: string | null) => string
): Promise<AuditHistoryChunkResult>;
