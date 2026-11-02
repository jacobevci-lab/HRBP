-- Additive job-architecture foundation. Existing Position.jobFamily/grade text
-- remains intact for migration compatibility while positions can opt into a
-- governed JobProfile reference.
CREATE TYPE "JobProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "JobFamily" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobFamily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobLevel" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobLevel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobLevel_rank_check" CHECK ("rank" >= 1 AND "rank" <= 1000)
);

CREATE TABLE "JobProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "levelId" TEXT NOT NULL,
  "description" TEXT,
  "status" "JobProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobProfile_effective_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE TABLE "JobProfileSkillRequirement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobProfileId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "targetProficiency" "SkillProficiency" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobProfileSkillRequirement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Position" ADD COLUMN "jobProfileId" TEXT;

CREATE UNIQUE INDEX "JobFamily_tenantId_code_key" ON "JobFamily"("tenantId", "code");
CREATE INDEX "JobFamily_tenantId_active_name_idx" ON "JobFamily"("tenantId", "active", "name");

CREATE UNIQUE INDEX "JobLevel_tenantId_code_key" ON "JobLevel"("tenantId", "code");
CREATE INDEX "JobLevel_tenantId_active_rank_idx" ON "JobLevel"("tenantId", "active", "rank");

CREATE UNIQUE INDEX "JobProfile_tenantId_code_effectiveFrom_key" ON "JobProfile"("tenantId", "code", "effectiveFrom");
CREATE INDEX "JobProfile_tenantId_status_effectiveTo_idx" ON "JobProfile"("tenantId", "status", "effectiveTo");
CREATE INDEX "JobProfile_tenantId_familyId_levelId_idx" ON "JobProfile"("tenantId", "familyId", "levelId");

CREATE UNIQUE INDEX "JobProfileSkillRequirement_jobProfileId_skillId_key"
  ON "JobProfileSkillRequirement"("jobProfileId", "skillId");
CREATE INDEX "JobProfileSkillRequirement_tenantId_skillId_targetProficiency_idx"
  ON "JobProfileSkillRequirement"("tenantId", "skillId", "targetProficiency");

CREATE INDEX "Position_tenantId_jobProfileId_idx" ON "Position"("tenantId", "jobProfileId");

ALTER TABLE "JobFamily"
  ADD CONSTRAINT "JobFamily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobLevel"
  ADD CONSTRAINT "JobLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobProfile"
  ADD CONSTRAINT "JobProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobProfile"
  ADD CONSTRAINT "JobProfile_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "JobFamily"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobProfile"
  ADD CONSTRAINT "JobProfile_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "JobLevel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobProfileSkillRequirement"
  ADD CONSTRAINT "JobProfileSkillRequirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobProfileSkillRequirement"
  ADD CONSTRAINT "JobProfileSkillRequirement_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobProfileSkillRequirement"
  ADD CONSTRAINT "JobProfileSkillRequirement_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Position"
  ADD CONSTRAINT "Position_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
