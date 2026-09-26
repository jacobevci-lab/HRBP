type DocumentProjection = {
  id: string;
  tenantId: string;
  personId: string | null;
  caseId: string | null;
  fileName: string;
  contentType: string;
  purpose: string;
  classification: unknown;
  status: unknown;
  createdById: string;
  createdAt: Date;
  expiresAt: Date | null;
  retentionUntil: Date | null;
  legalHold: boolean;
};

type DocumentVersionProjection = {
  id: string;
  tenantId: string;
  documentId: string;
  version: number;
  contentType: string;
  sizeBytes: bigint | null;
  contentHash: string;
  classification: unknown;
  scanStatus: unknown;
  uploadedAt: Date | null;
  scanCompletedAt: Date | null;
  scanEngine: string | null;
  scanReference: string | null;
  scanMessage: string | null;
  createdById: string;
  createdAt: Date;
};

/**
 * Browser/API projections deliberately omit private object-store keys.
 * Object keys are server-side capabilities and must never cross the public API boundary.
 */
export function publicDocument<T extends DocumentProjection>(value: T) {
  return {
    id: value.id,
    tenantId: value.tenantId,
    personId: value.personId,
    caseId: value.caseId,
    fileName: value.fileName,
    contentType: value.contentType,
    purpose: value.purpose,
    classification: value.classification,
    status: value.status,
    createdById: value.createdById,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    retentionUntil: value.retentionUntil,
    legalHold: value.legalHold
  };
}

export function publicDocumentVersion<T extends DocumentVersionProjection>(value: T) {
  return {
    id: value.id,
    tenantId: value.tenantId,
    documentId: value.documentId,
    version: value.version,
    contentType: value.contentType,
    sizeBytes: value.sizeBytes === null ? null : value.sizeBytes.toString(),
    contentHash: value.contentHash,
    classification: value.classification,
    scanStatus: value.scanStatus,
    uploadedAt: value.uploadedAt,
    scanCompletedAt: value.scanCompletedAt,
    scanEngine: value.scanEngine,
    scanReference: value.scanReference,
    scanMessage: value.scanMessage,
    createdById: value.createdById,
    createdAt: value.createdAt
  };
}
