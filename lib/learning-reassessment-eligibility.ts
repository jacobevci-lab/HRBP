import { DevelopmentPlanStatus } from "@prisma/client";

type LinkedDevelopmentPlan = {
  tenantId: string;
  employmentId: string;
  status: DevelopmentPlanStatus;
} | null;

type LinkedSuccessionCandidate = {
  tenantId: string;
  employmentId: string;
  active: boolean;
  plan: { tenantId: string; active: boolean };
} | null;

/**
 * A completed course is evidence for a human-owned reassessment, not an
 * automatic proficiency or successor-readiness decision.
 *
 * Suppress stale decision requests when the linked plan/candidate has been
 * closed, removed, or accidentally associated with another employee/tenant.
 * The learning completion itself must remain possible for historical evidence.
 */
export function learningReassessmentEligibility(input: {
  tenantId: string;
  employmentId: string;
  hasSkillEvidence: boolean;
  developmentPlan: LinkedDevelopmentPlan;
  successionCandidate: LinkedSuccessionCandidate;
}) {
  const { tenantId, employmentId, hasSkillEvidence, developmentPlan, successionCandidate } = input;
  return {
    developmentPlan: Boolean(
      hasSkillEvidence &&
      developmentPlan &&
      developmentPlan.status === DevelopmentPlanStatus.ACTIVE &&
      developmentPlan.tenantId === tenantId &&
      developmentPlan.employmentId === employmentId
    ),
    succession: Boolean(
      hasSkillEvidence &&
      successionCandidate?.active &&
      successionCandidate.tenantId === tenantId &&
      successionCandidate.employmentId === employmentId &&
      successionCandidate.plan.active &&
      successionCandidate.plan.tenantId === tenantId
    )
  };
}
