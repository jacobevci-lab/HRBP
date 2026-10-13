ALTER TABLE "SuccessionCandidate"
ADD COLUMN "readinessReason" TEXT,
ADD COLUMN "readinessReviewedAt" TIMESTAMP(3),
ADD COLUMN "readinessReviewedById" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "SuccessionCandidate"
SET "updatedAt" = "addedAt"
WHERE "updatedAt" IS NULL;

ALTER TABLE "SuccessionCandidate"
ALTER COLUMN "updatedAt" SET NOT NULL;
