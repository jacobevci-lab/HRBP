-- Add tenant-wide and account-scoped session revocation versions.
-- Existing sessions are intentionally invalidated when the application requires
-- the new signed-session contract; future revocations increment these values.

ALTER TABLE "Tenant"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);

ALTER TABLE "UserAccount"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
