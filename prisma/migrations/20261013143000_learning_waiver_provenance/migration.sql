-- Preserve existing learning history while recording explicit waiver decisions.
-- Previously waived assignments keep nullable legacy provenance.
ALTER TABLE "LearningAssignment"
  ADD COLUMN "waivedAt" TIMESTAMP(3),
  ADD COLUMN "waivedById" TEXT,
  ADD COLUMN "waiverReason" TEXT;
