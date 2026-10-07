ALTER TYPE "VaultScanStatus" ADD VALUE IF NOT EXISTS 'SCANNING';

ALTER TABLE "DocumentVersion"
  ADD COLUMN "scanAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scanLockedAt" TIMESTAMP(3),
  ADD COLUMN "scanNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_scanAttempts_nonnegative"
  CHECK ("scanAttempts" >= 0);

CREATE INDEX "DocumentVersion_scanStatus_scanNextAttemptAt_createdAt_idx"
  ON "DocumentVersion"("scanStatus", "scanNextAttemptAt", "createdAt");
