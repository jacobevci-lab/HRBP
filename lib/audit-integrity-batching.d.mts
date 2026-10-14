export type AuditIntegrityBatchInput = {
  now: Date;
  tenantCount: number;
  requestedTenantBatchSize: number;
  verificationLimit: number;
};
export type AuditIntegrityBatch = {
  tenantBatchSize: number;
  batchCount: number;
  batchIndex: number;
  skip: number;
  take: number;
  quarterHourSlot: number;
  maxVerificationEvents: number;
};
export declare function selectAuditIntegrityBatch(input: AuditIntegrityBatchInput): AuditIntegrityBatch;
