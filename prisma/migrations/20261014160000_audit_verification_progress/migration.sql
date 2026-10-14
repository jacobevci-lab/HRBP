-- Tracks when each tenant ledger was last checked and how far its
-- verified tail reached. This is operational coverage, not a signing key,
-- independent checkpoint or substitute for full-history verification.
CREATE TABLE "AuditVerificationProgress" (
  "tenantId" TEXT NOT NULL,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastVerifiedSequence" BIGINT,
  "lastVerifiedScope" TEXT,
  "lastResult" TEXT NOT NULL,
  "checkedEvents" INTEGER NOT NULL DEFAULT 0,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AuditVerificationProgress_pkey" PRIMARY KEY ("tenantId")
);

CREATE INDEX "AuditVerificationProgress_lastSuccessAt_tenantId_idx"
  ON "AuditVerificationProgress"("lastSuccessAt", "tenantId");

ALTER TABLE "AuditVerificationProgress"
  ADD CONSTRAINT "AuditVerificationProgress_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
