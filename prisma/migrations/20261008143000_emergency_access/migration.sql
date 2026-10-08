CREATE TYPE "EmergencyAccessStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "EmergencyAccessGrant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedMinutes" INTEGER NOT NULL,
  "status" "EmergencyAccessStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "revokedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencyAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmergencyAccessGrant_tenantId_status_validTo_idx"
  ON "EmergencyAccessGrant"("tenantId", "status", "validTo");

CREATE INDEX "EmergencyAccessGrant_tenantId_requesterId_status_idx"
  ON "EmergencyAccessGrant"("tenantId", "requesterId", "status");

CREATE INDEX "EmergencyAccessGrant_tenantId_decidedById_decidedAt_idx"
  ON "EmergencyAccessGrant"("tenantId", "decidedById", "decidedAt");

ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_requestedMinutes_check"
  CHECK ("requestedMinutes" BETWEEN 15 AND 60);
