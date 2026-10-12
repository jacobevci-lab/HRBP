ALTER TABLE "SuccessionPlan"
ADD COLUMN "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN "lastReviewedById" TEXT,
ADD COLUMN "lastReviewSummary" TEXT;
