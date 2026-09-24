import { DataClassification, PlatformRole, Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

type DevelopmentPlanReassessmentInput = {
  tenantId: string;
  assignmentId: string;
  planId: string;
  ownerId: string | null;
  planTitle: string;
  courseCode: string;
  courseTitle: string;
  skillCode: string;
  skillName: string;
  targetProficiency: string;
};

type DevelopmentPlanActivatedInput = {
  tenantId: string;
  employmentId: string;
  planId: string;
  planTitle: string;
  targetAt: Date;
  skillCode?: string | null;
  skillName?: string | null;
  targetProficiency?: string | null;
};

/**
 * Learning completion is evidence for a development plan, not proof that a
 * skill target has been achieved. The plan owner (or Talent Admin fallback)
 * must reassess the employee before the development plan can be completed.
 */
export async function enqueueDevelopmentPlanReassessment(
  tx: Prisma.TransactionClient,
  input: DevelopmentPlanReassessmentInput
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "DEVELOPMENT_PLAN_REASSESSMENT_REQUIRED",
    recipientUserId: input.ownerId,
    recipientRole: input.ownerId ? null : PlatformRole.TALENT_ADMIN,
    templateKey: "talent.development-plan-reassessment-required",
    resourceType: "DevelopmentPlan",
    resourceId: input.planId,
    dedupeKey: `development-plan:${input.assignmentId}:reassessment`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      assignmentId: input.assignmentId,
      planTitle: input.planTitle,
      courseCode: input.courseCode,
      courseTitle: input.courseTitle,
      skillCode: input.skillCode,
      skillName: input.skillName,
      targetProficiency: input.targetProficiency
    }
  });
}

/**
 * Development plans become visible/actionable to employees only once activated.
 * Identity resolution mirrors the OIDC work-email bridge used elsewhere in the
 * platform and never broadcasts employee-specific plan details to a role.
 */
export async function enqueueDevelopmentPlanActivated(
  tx: Prisma.TransactionClient,
  input: DevelopmentPlanActivatedInput
) {
  const employment = await tx.employment.findFirst({
    where: { id: input.employmentId, tenantId: input.tenantId },
    select: { person: { select: { workEmail: true } } }
  });
  const email = employment?.person.workEmail?.trim();
  if (!email) return null;

  const user = await tx.userAccount.findFirst({
    where: { tenantId: input.tenantId, active: true, email: { equals: email, mode: "insensitive" } },
    select: { id: true }
  });
  if (!user) return null;

  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "DEVELOPMENT_PLAN_ACTIVATED",
    recipientUserId: user.id,
    templateKey: "talent.development-plan-activated",
    resourceType: "DevelopmentPlanParticipant",
    resourceId: input.planId,
    dedupeKey: `development-plan:${input.planId}:activated`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      planTitle: input.planTitle,
      targetAt: input.targetAt.toISOString(),
      skillCode: input.skillCode ?? null,
      skillName: input.skillName ?? null,
      targetProficiency: input.targetProficiency ?? null
    }
  });
}
