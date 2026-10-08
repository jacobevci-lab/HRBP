ALTER TABLE "UserAccount"
  ADD COLUMN "provisioningSource" TEXT,
  ADD COLUMN "provisioningExternalId" TEXT,
  ADD COLUMN "provisionedAt" TIMESTAMP(3),
  ADD COLUMN "provisioningUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "UserAccount_tenantId_provisioningSource_provisioningExterna_key"
  ON "UserAccount"("tenantId", "provisioningSource", "provisioningExternalId");

CREATE INDEX "UserAccount_tenantId_provisioningSource_active_idx"
  ON "UserAccount"("tenantId", "provisioningSource", "active");
