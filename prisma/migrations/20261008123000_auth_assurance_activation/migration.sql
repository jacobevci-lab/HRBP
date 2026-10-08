ALTER TABLE "TenantSecurityPolicy"
  ADD COLUMN "assuranceEnforcedAt" TIMESTAMP(3);

-- Existing rows predate runtime enforcement. Keep them inactive until an
-- assured administrator explicitly re-saves the tenant security policy.
