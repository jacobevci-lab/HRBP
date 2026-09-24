import { DataClassification, LearningAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

export async function queueLearningReminders() {
  const now = new Date();
  const warningDays = Math.min(90, Math.max(1, Math.floor(runtimeNumber("HRBP_LEARNING_DUE_SOON_DAYS", 7))));
  const dueSoonAt = new Date(now.getTime() + warningDays * 86_400_000);
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_LEARNING_REMINDER_BATCH_SIZE", 500))));

  const assignments = await db.learningAssignment.findMany({
    where: {
      status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] },
      dueAt: { not: null, lte: dueSoonAt }
    },
    orderBy: { dueAt: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      employmentId: true,
      status: true,
      dueAt: true,
      course: { select: { code: true, title: true, mandatory: true } }
    }
  });

  const employmentKeys = [...new Map(assignments.map((row) => [`${row.tenantId}:${row.employmentId}`, { tenantId: row.tenantId, id: row.employmentId }])).values()];
  const employments = employmentKeys.length ? await db.employment.findMany({
    where: { OR: employmentKeys },
    select: { id: true, tenantId: true, person: { select: { workEmail: true } } }
  }) : [];
  const employmentMap = new Map(employments.map((row) => [`${row.tenantId}:${row.id}`, row.person.workEmail?.trim().toLowerCase() ?? null]));

  const userPairs = [...new Map(employments.flatMap((row) => {
    const email = row.person.workEmail?.trim().toLowerCase();
    return email ? [[`${row.tenantId}:${email}`, { tenantId: row.tenantId, email }]] : [];
  })).values()];
  const users = userPairs.length ? await db.userAccount.findMany({
    where: { active: true, OR: userPairs.map((pair) => ({ tenantId: pair.tenantId, email: { equals: pair.email, mode: "insensitive" as const } })) },
    select: { id: true, tenantId: true, email: true }
  }) : [];
  const userMap = new Map(users.map((user) => [`${user.tenantId}:${user.email.trim().toLowerCase()}`, user.id]));

  let dueSoon = 0;
  let overdue = 0;
  let skippedUnprovisioned = 0;

  for (const assignment of assignments) {
    if (!assignment.dueAt) continue;
    const email = employmentMap.get(`${assignment.tenantId}:${assignment.employmentId}`);
    const userId = email ? userMap.get(`${assignment.tenantId}:${email}`) : undefined;
    if (!userId) {
      skippedUnprovisioned += 1;
      continue;
    }

    const isOverdue = assignment.dueAt < now || assignment.status === LearningAssignmentStatus.OVERDUE;
    const eventType = isOverdue ? "LEARNING_ASSIGNMENT_OVERDUE" : "LEARNING_ASSIGNMENT_DUE_SOON";
    const reminderKey = isOverdue ? "overdue" : "due-soon";

    await db.$transaction(async (tx) => {
      await enqueueNotificationOutbox(tx, {
        tenantId: assignment.tenantId,
        eventType,
        recipientUserId: userId,
        templateKey: isOverdue ? "learning.assignment-overdue" : "learning.assignment-due-soon",
        resourceType: "LearningAssignment",
        resourceId: assignment.id,
        dedupeKey: `learning-assignment:${assignment.id}:${reminderKey}:${assignment.dueAt!.toISOString().slice(0, 10)}`,
        classification: DataClassification.CONFIDENTIAL,
        payload: {
          courseCode: assignment.course.code,
          courseTitle: assignment.course.title,
          mandatory: assignment.course.mandatory,
          dueAt: assignment.dueAt!.toISOString(),
          warningDays
        }
      });
    });

    if (isOverdue) overdue += 1;
    else dueSoon += 1;
  }

  return {
    scanned: assignments.length,
    queuedDueSoon: dueSoon,
    queuedOverdue: overdue,
    skippedUnprovisioned,
    dueSoonWindowDays: warningDays
  };
}
