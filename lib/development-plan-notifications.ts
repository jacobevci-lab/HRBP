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
