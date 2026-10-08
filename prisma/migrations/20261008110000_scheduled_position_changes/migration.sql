CREATE TYPE "ScheduledPositionChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'BLOCKED', 'CANCELLED');

CREATE TABLE "ScheduledPositionChange" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "employmentId" TEXT NOT NULL,
  "sourcePositionId" TEXT,
  "targetPositionId" TEXT NOT NULL,
  "eventType" "LifecycleEventType" NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "impactDigest" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "status" "ScheduledPositionChangeStatus" NOT NULL DEFAULT 'PENDING',
  "blockedCode" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScheduledPositionChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledPositionChange_tenantId_status_effectiveAt_idx"
  ON "ScheduledPositionChange"("tenantId", "status", "effectiveAt");

CREATE INDEX "ScheduledPositionChange_tenantId_employmentId_status_idx"
  ON "ScheduledPositionChange"("tenantId", "employmentId", "status");

CREATE INDEX "ScheduledPositionChange_tenantId_targetPositionId_status_idx"
  ON "ScheduledPositionChange"("tenantId", "targetPositionId", "status");

CREATE INDEX "ScheduledPositionChange_tenantId_requestedById_createdAt_idx"
  ON "ScheduledPositionChange"("tenantId", "requestedById", "createdAt");

ALTER TABLE "ScheduledPositionChange"
  ADD CONSTRAINT "ScheduledPositionChange_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledPositionChange"
  ADD CONSTRAINT "ScheduledPositionChange_employmentId_fkey"
  FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledPositionChange"
  ADD CONSTRAINT "ScheduledPositionChange_sourcePositionId_fkey"
  FOREIGN KEY ("sourcePositionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledPositionChange"
  ADD CONSTRAINT "ScheduledPositionChange_targetPositionId_fkey"
  FOREIGN KEY ("targetPositionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
