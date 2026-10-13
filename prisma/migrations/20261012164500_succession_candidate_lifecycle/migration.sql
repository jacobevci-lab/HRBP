ALTER TABLE "SuccessionCandidate"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "removedAt" TIMESTAMP(3),
ADD COLUMN "removedById" TEXT,
ADD COLUMN "removalReason" TEXT;
