-- Preserve existing catalog rows while establishing concurrency checkpoints.
ALTER TABLE "Skill" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Skill" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "Skill" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "LearningCourse" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "LearningCourse" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "LearningCourse" ALTER COLUMN "updatedAt" SET NOT NULL;
