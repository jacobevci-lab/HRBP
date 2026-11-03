-- User-owned enterprise table views. These records store presentation preferences
-- only; they never store or broaden authorization scope.
CREATE TABLE "SavedEnterpriseView" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "query" TEXT NOT NULL DEFAULT '',
  "status" TEXT,
  "columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "columnsCustomized" BOOLEAN NOT NULL DEFAULT false,
  "density" TEXT NOT NULL DEFAULT 'comfortable',
  "sortKey" TEXT,
  "sortDirection" TEXT NOT NULL DEFAULT 'asc',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedEnterpriseView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedEnterpriseView_module_check" CHECK ("moduleKey" IN ('people', 'positions')),
  CONSTRAINT "SavedEnterpriseView_name_check" CHECK (char_length("name") BETWEEN 1 AND 64),
  CONSTRAINT "SavedEnterpriseView_query_check" CHECK (char_length("query") <= 160),
  CONSTRAINT "SavedEnterpriseView_status_check" CHECK ("status" IS NULL OR char_length("status") <= 40),
  CONSTRAINT "SavedEnterpriseView_density_check" CHECK ("density" IN ('comfortable', 'compact')),
  CONSTRAINT "SavedEnterpriseView_sort_key_check" CHECK ("sortKey" IS NULL OR char_length("sortKey") <= 40),
  CONSTRAINT "SavedEnterpriseView_sort_direction_check" CHECK ("sortDirection" IN ('asc', 'desc'))
);

CREATE UNIQUE INDEX "SavedEnterpriseView_tenantId_userId_moduleKey_normalizedNam_key"
  ON "SavedEnterpriseView"("tenantId", "userId", "moduleKey", "normalizedName");

CREATE INDEX "SavedEnterpriseView_tenantId_userId_moduleKey_updatedAt_idx"
  ON "SavedEnterpriseView"("tenantId", "userId", "moduleKey", "updatedAt");

ALTER TABLE "SavedEnterpriseView"
  ADD CONSTRAINT "SavedEnterpriseView_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedEnterpriseView"
  ADD CONSTRAINT "SavedEnterpriseView_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
