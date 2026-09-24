import { DataClassification, PlatformRole, Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

type SuccessionDevelopmentCompletionInput = {
  tenantId: string;
  assignmentId: string;
  candidateId: string;
  ownerId: string | null;
  positionCode: string;
  positionTitle: string;
  courseCode: string;
  courseTitle: string;
  skillCode: string;
  skillName: string;
  targetProficiency: string;
};

/**
 * Closing a development learning item is evidence, not an automatic readiness decision.
 * The succession owner (or Talent Admin fallback) receives an explicit reassessment task
 * so proficiency and successor readiness remain human-owned decisions.
 */
export async function enqueueSuccessionDevelopmentReassessment(
  tx: Prisma.TransactionClient,
  input: SuccessionDevelopmentCompletionInput
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "SUCCESSION_DEVELOPMENT_REASSESSMENT_REQUIRED",
    recipientUserId: input.ownerId,
    recipientRole: input.ownerId ? null : PlatformRole.TALENT_ADMIN,
    templateKey: "succession.development-reassessment-required",
    resourceType: "SuccessionCandidate",
    resourceId: input.candidateId,
    dedupeKey: `succession-development:${input.assignmentId}:reassessment`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      assignmentId: input.assignmentId,
      positionCode: input.positionCode,
      positionTitle: input.positionTitle,
      courseCode: input.courseCode,
      courseTitle: input.courseTitle,
      skillCode: input.skillCode,
      skillName: input.skillName,
      targetProficiency: input.targetProficiency
    }
  });
}
