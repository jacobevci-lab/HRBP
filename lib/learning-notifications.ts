import type { Prisma } from "@prisma/client";
import { DataClassification } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

export async function enqueueLearningAssignmentNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    employmentId: string;
    assignmentId: string;
    courseCode: string;
    courseTitle: string;
    dueAt: Date | null;
  }
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
    eventType: "LEARNING_ASSIGNMENT_READY",
    recipientUserId: user.id,
    templateKey: "learning.assignment-ready",
    resourceType: "LearningAssignment",
    resourceId: input.assignmentId,
    dedupeKey: `learning-assignment:${input.assignmentId}:ready`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      courseCode: input.courseCode,
      courseTitle: input.courseTitle,
      dueAt: input.dueAt?.toISOString() ?? null
    }
  });
}
