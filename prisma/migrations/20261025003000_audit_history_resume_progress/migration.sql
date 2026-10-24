-- Durable cross-run full-history verification state. This migration adds
-- operational metadata only; it never rewrites, backfills or deletes AuditEvent.
CREATE TABLE "AuditHistoryVerificationProgress" (
  "tenantId" TEXT NOT NULL,
  "scanVersion" INTEGER NOT NULL DEFAULT 1,
  "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL,
  "targetSequence" BIGINT,
  "targetTailHash" TEXT,
  "verifiedSequence" BIGINT NOT NULL DEFAULT 0,
  "verifiedHash" TEXT,
  "checkedEvents" BIGINT NOT NULL DEFAULT 0,
  "scanStartedAt" TIMESTAMP(3) NOT NULL,
  "targetCapturedAt" TIMESTAMP(3) NOT NULL,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  CONSTRAINT "AuditHistoryVerificationProgress_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "AuditHistoryVerificationProgress_status_check"
    CHECK ("status" IN ('RUNNING', 'VALID', 'INVALID')),
  CONSTRAINT "AuditHistoryVerificationProgress_sequence_check"
    CHECK ("verifiedSequence" >= 0 AND "checkedEvents" >= 0 AND
      ("targetSequence" IS NULL OR "targetSequence" >= 0)),
  CONSTRAINT "AuditHistoryVerificationProgress_verified_hash_check"
    CHECK (("verifiedSequence" = 0 AND "verifiedHash" IS NULL) OR
      ("verifiedSequence" > 0 AND "verifiedHash" ~ '^[a-f0-9]{64}$')),
  CONSTRAINT "AuditHistoryVerificationProgress_target_hash_check"
    CHECK ("targetSequence" IS NULL OR
      ("targetSequence" = 0 AND "targetTailHash" IS NULL) OR
      ("targetSequence" > 0 AND "targetTailHash" ~ '^[a-f0-9]{64}$')),
  CONSTRAINT "AuditHistoryVerificationProgress_running_target_check"
    CHECK ("status" = 'INVALID' OR "targetSequence" IS NOT NULL),
  CONSTRAINT "AuditHistoryVerificationProgress_completion_check"
    CHECK (
      ("status" = 'RUNNING' AND "completedAt" IS NULL AND "failureCode" IS NULL) OR
      ("status" = 'VALID' AND "completedAt" IS NOT NULL AND "lastSuccessAt" IS NOT NULL
        AND "failureCode" IS NULL AND "targetSequence" = "verifiedSequence"
        AND "targetTailHash" IS NOT DISTINCT FROM "verifiedHash") OR
      ("status" = 'INVALID' AND "completedAt" IS NOT NULL AND "lastFailureAt" IS NOT NULL
        AND "failureCode" IS NOT NULL)
    )
);

CREATE INDEX "AuditHistoryVerificationProgress_status_lastAttemptAt_tenantId_idx"
  ON "AuditHistoryVerificationProgress"("status", "lastAttemptAt", "tenantId");
CREATE INDEX "AuditHistoryVerificationProgress_lastSuccessAt_tenantId_idx"
  ON "AuditHistoryVerificationProgress"("lastSuccessAt", "tenantId");

CREATE TABLE "AuditHistoryVerificationStats" (
  "id" TEXT NOT NULL,
  "scanVersion" INTEGER NOT NULL DEFAULT 1,
  "eventsChecked" BIGINT NOT NULL DEFAULT 0,
  "partialChunks" BIGINT NOT NULL DEFAULT 0,
  "successfulScans" BIGINT NOT NULL DEFAULT 0,
  "failedScans" BIGINT NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  CONSTRAINT "AuditHistoryVerificationStats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditHistoryVerificationStats_nonnegative_check"
    CHECK ("eventsChecked" >= 0 AND "partialChunks" >= 0 AND
      "successfulScans" >= 0 AND "failedScans" >= 0)
);
