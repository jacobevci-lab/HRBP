import { DataClassification, LearningAssignmentStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { learningDueDayStartUtc } from "@/lib/learning-due-date";
import { runtimeNumber } from "@/lib/runtime-env";
import type { RequestContext } from "@/lib/request-context";

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:learning-maintenance",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled learning lifecycle maintenance"
  };
}

export async function runLearningMaintenance() {
  const now = new Date();
  const overdueBefore = learningDueDayStartUtc(now);
  const maxBatch = Math.min(2000, Math.max(25, Math.floor(runtimeNumber("HRBP_LEARNING_MAINTENANCE_BATCH_SIZE", 500))));
  const candidates = await db.learningAssignment.findMany({
    where: {
      status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS] },
      dueAt: { not: null, lt: overdueBefore }
    },
    orderBy: { dueAt: "asc" },
    take: maxBatch,
    select: { id: true, tenantId: true, status: true, dueAt: true }
  });

  let transitioned = 0;
  for (const candidate of candidates) {
    const changed = await db.$transaction(async (tx) => {
      const result = await tx.learningAssignment.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          status: candidate.status,
          dueAt: { not: null, lt: overdueBefore }
        },
        data: { status: LearningAssignmentStatus.OVERDUE }
      });
      if (result.count !== 1) return false;

      await appendAudit(tx, systemContext(candidate.tenantId), {
        action: "learning-assignment.auto-overdue",
        resourceType: "LearningAssignment",
        resourceId: candidate.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: candidate.dueAt ? `Learning calendar due date elapsed: ${candidate.dueAt.toISOString().slice(0, 10)}` : "Learning calendar due date elapsed"
      });
      return true;
    });
    if (changed) transitioned += 1;
  }

  return {
    scanned: candidates.length,
    transitionedOverdue: transitioned,
    checkedAt: now.toISOString()
  };
}
