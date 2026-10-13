ALTER TABLE "EmploymentSkill"
ADD COLUMN "assessmentReason" TEXT,
ADD COLUMN "assessedById" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "EmploymentSkill"
SET "updatedAt" = "assessedAt"
WHERE "updatedAt" IS NULL;

ALTER TABLE "EmploymentSkill"
ALTER COLUMN "updatedAt" SET NOT NULL;
