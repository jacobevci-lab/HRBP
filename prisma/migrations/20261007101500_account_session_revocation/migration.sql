-- Account-scoped session epochs allow immediate revocation without storing bearer tokens.
ALTER TABLE "UserAccount"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);

ALTER TABLE "UserAccount"
  ADD CONSTRAINT "UserAccount_sessionVersion_positive"
  CHECK ("sessionVersion" >= 1);
