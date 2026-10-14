-- Additive operational state only. Never rewrite audit evidence or receipts.
CREATE TABLE "AuditVerificationSchedule" (
  "id" TEXT NOT NULL,
  "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
  "cursorTenantId" TEXT,
  "cursorCreatedAt" TIMESTAMP(3),
  "upperTenantId" TEXT,
  "upperCreatedAt" TIMESTAMP(3),
  "cycleStartedAt" TIMESTAMP(3),
  "lastCycleCompletedAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  CONSTRAINT "AuditVerificationSchedule_pkey" PRIMARY KEY ("id")
);
