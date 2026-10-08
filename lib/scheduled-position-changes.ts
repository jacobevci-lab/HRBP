import {
  DataClassification,
  EmploymentStatus,
  LifecycleEventType,
  PlatformRole,
  PositionStatus,
  Prisma,
  RequisitionStatus,
  ScheduledPositionChangeStatus
} from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { positionChangeImpactDigest } from "@/lib/employee-position-change-preview";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

const activeEmploymentStatuses: EmploymentStatus[] = [
  EmploymentStatus.PREBOARDING,
  EmploymentStatus.ACTIVE,
  EmploymentStatus.LEAVE,
  EmploymentStatus.SUSPENDED
];

const openRequisitionStatuses = [
  RequisitionStatus.DRAFT,
  RequisitionStatus.APPROVAL,
  RequisitionStatus.OPEN,
  RequisitionStatus.ON_HOLD
];

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:scheduled-job-change",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled employee position change"
  };
}

async function blockScheduledChange(
  tx: Prisma.TransactionClient,
  change: {
    id: string;
    tenantId: string;
    requestedById: string;
    employmentId: string;
    targetPositionId: string;
  },
  now: Date,
  code: string
) {
  const updated = await tx.scheduledPositionChange.updateMany({
    where: { id: change.id, tenantId: change.tenantId, status: ScheduledPositionChangeStatus.PENDING },
    data: {
      status: ScheduledPositionChangeStatus.BLOCKED,
      blockedCode: code,
      attempts: { increment: 1 },
      lastAttemptAt: now
    }
  });
  if (updated.count !== 1) return false;

  await appendAudit(tx, systemContext(change.tenantId), {
    action: "EMPLOYEE_POSITION_CHANGE_BLOCKED",
    resourceType: "ScheduledPositionChange",
    resourceId: change.id,
    classification: DataClassification.CONFIDENTIAL,
    purpose: `Scheduled position change blocked: ${code}`
  });

  await enqueueNotificationOutbox(tx, {
    tenantId: change.tenantId,
    eventType: "EMPLOYEE_POSITION_CHANGE_BLOCKED",
    recipientUserId: change.requestedById,
    templateKey: "employee.position-change.blocked",
    resourceType: "ScheduledPositionChange",
    resourceId: change.id,
    dedupeKey: `scheduled-position-change:${change.id}:blocked:${code}`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      employmentId: change.employmentId,
      targetPositionId: change.targetPositionId,
      blockedCode: code
    }
  });

  return true;
}

export async function runScheduledPositionChanges(now = new Date()) {
  const maxBatch = Math.min(250, Math.max(10, Math.floor(runtimeNumber("HRBP_SCHEDULED_JOB_CHANGE_BATCH_SIZE", 100))));
  const due = await db.scheduledPositionChange.findMany({
    where: {
      status: ScheduledPositionChangeStatus.PENDING,
      effectiveAt: { lte: now }
    },
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      personId: true,
      employmentId: true,
      sourcePositionId: true,
      targetPositionId: true,
      eventType: true,
      effectiveAt: true,
      reason: true,
      impactDigest: true,
      requestedById: true
    }
  });

  let applied = 0;
  let blocked = 0;
  let notificationsQueued = 0;

  for (const change of due) {
    const outcome = await db.$transaction(async (tx) => {
      const fresh = await tx.scheduledPositionChange.findFirst({
        where: {
          id: change.id,
          tenantId: change.tenantId,
          status: ScheduledPositionChangeStatus.PENDING,
          effectiveAt: { lte: now }
        },
        select: { id: true }
      });
      if (!fresh) return "skipped" as const;

      const employment = await tx.employment.findFirst({
        where: {
          id: change.employmentId,
          tenantId: change.tenantId,
          personId: change.personId,
          status: { in: activeEmploymentStatuses }
        },
        select: {
          id: true,
          positionId: true,
          managerEmploymentId: true,
          position: {
            select: {
              id: true,
              positionCode: true,
              title: true,
              grade: true,
              location: true,
              critical: true,
              orgUnit: { select: { id: true, name: true } }
            }
          },
          _count: { select: { directReports: true } }
        }
      });

      if (!employment) {
        await blockScheduledChange(tx, change, now, "EMPLOYMENT_NOT_ACTIVE");
        return "blocked" as const;
      }
      if (employment.positionId !== change.sourcePositionId) {
        await blockScheduledChange(tx, change, now, "SOURCE_POSITION_CHANGED");
        return "blocked" as const;
      }

      const target = await tx.position.findFirst({
        where: {
          id: change.targetPositionId,
          tenantId: change.tenantId,
          validTo: null
        },
        select: {
          id: true,
          positionCode: true,
          title: true,
          grade: true,
          location: true,
          critical: true,
          status: true,
          orgUnit: { select: { id: true, name: true } }
        }
      });
      if (!target) {
        await blockScheduledChange(tx, change, now, "TARGET_POSITION_NOT_FOUND");
        return "blocked" as const;
      }
      if (target.status !== PositionStatus.OPEN) {
        await blockScheduledChange(tx, change, now, "TARGET_POSITION_NOT_OPEN");
        return "blocked" as const;
      }

      const [incumbent, openTargetRequisitionCount] = await Promise.all([
        tx.employment.findFirst({
          where: {
            tenantId: change.tenantId,
            positionId: target.id,
            status: { in: activeEmploymentStatuses },
            NOT: { id: employment.id }
          },
          select: { id: true }
        }),
        tx.requisition.count({
          where: {
            tenantId: change.tenantId,
            positionId: target.id,
            status: { in: openRequisitionStatuses }
          }
        })
      ]);
      if (incumbent) {
        await blockScheduledChange(tx, change, now, "TARGET_POSITION_OCCUPIED");
        return "blocked" as const;
      }

      const currentImpactDigest = positionChangeImpactDigest({
        sourcePositionId: employment.positionId,
        sourcePositionCode: employment.position?.positionCode ?? null,
        sourceTitle: employment.position?.title ?? null,
        sourceOrgUnitId: employment.position?.orgUnit.id ?? null,
        sourceOrgUnitName: employment.position?.orgUnit.name ?? null,
        sourceGrade: employment.position?.grade ?? null,
        sourceLocation: employment.position?.location ?? null,
        sourceCritical: employment.position?.critical ?? false,
        managerEmploymentId: employment.managerEmploymentId,
        directReportCount: employment._count.directReports,
        targetPositionId: target.id,
        targetPositionCode: target.positionCode,
        targetTitle: target.title,
        targetOrgUnitId: target.orgUnit.id,
        targetOrgUnitName: target.orgUnit.name,
        targetGrade: target.grade,
        targetLocation: target.location,
        targetCritical: target.critical,
        openTargetRequisitionCount
      });
      if (currentImpactDigest !== change.impactDigest) {
        await blockScheduledChange(tx, change, now, "IMPACT_STATE_CHANGED");
        return "blocked" as const;
      }

      const employmentUpdated = await tx.employment.updateMany({
        where: {
          id: employment.id,
          tenantId: change.tenantId,
          personId: change.personId,
          positionId: employment.positionId,
          status: { in: activeEmploymentStatuses }
        },
        data: { positionId: target.id }
      });
      if (employmentUpdated.count !== 1) {
        await blockScheduledChange(tx, change, now, "EMPLOYMENT_STATE_CONFLICT");
        return "blocked" as const;
      }

      if (employment.positionId) {
        await tx.position.updateMany({
          where: { id: employment.positionId, tenantId: change.tenantId },
          data: { status: PositionStatus.OPEN }
        });
      }

      const targetClaim = await tx.position.updateMany({
        where: {
          id: target.id,
          tenantId: change.tenantId,
          status: PositionStatus.OPEN,
          validTo: null
        },
        data: { status: PositionStatus.FILLED }
      });
      if (targetClaim.count !== 1) {
        throw new Error("TARGET_CLAIM_CONFLICT");
      }

      const fromLabel = employment.position ? `${employment.position.title} (${employment.position.positionCode})` : "Unassigned";
      const toLabel = `${target.title} (${target.positionCode})`;
      const lifecycle = await tx.employeeLifecycleEvent.create({
        data: {
          tenantId: change.tenantId,
          personId: change.personId,
          employmentId: employment.id,
          type: change.eventType,
          effectiveAt: change.effectiveAt,
          summary: `${change.eventType === LifecycleEventType.PROMOTED ? "Promoted" : "Transferred"} (scheduled): ${fromLabel} → ${toLabel}${change.reason ? ` · ${change.reason}` : ""}`,
          actorId: "system:scheduled-job-change"
        }
      });

      const finalized = await tx.scheduledPositionChange.updateMany({
        where: {
          id: change.id,
          tenantId: change.tenantId,
          status: ScheduledPositionChangeStatus.PENDING
        },
        data: {
          status: ScheduledPositionChangeStatus.APPLIED,
          appliedAt: now,
          lastAttemptAt: now,
          attempts: { increment: 1 },
          blockedCode: null
        }
      });
      if (finalized.count !== 1) throw new Error("SCHEDULE_STATE_CONFLICT");

      await appendAudit(tx, systemContext(change.tenantId), {
        action: change.eventType === LifecycleEventType.PROMOTED
          ? "EMPLOYEE_PROMOTION_SCHEDULE_APPLIED"
          : "EMPLOYEE_TRANSFER_SCHEDULE_APPLIED",
        resourceType: "ScheduledPositionChange",
        resourceId: change.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Applied reviewed future-dated employee position change after state revalidation"
      });

      await enqueueNotificationOutbox(tx, {
        tenantId: change.tenantId,
        eventType: "EMPLOYEE_POSITION_CHANGE_APPLIED",
        recipientUserId: change.requestedById,
        templateKey: "employee.position-change.applied",
        resourceType: "ScheduledPositionChange",
        resourceId: change.id,
        dedupeKey: `scheduled-position-change:${change.id}:applied`,
        classification: DataClassification.CONFIDENTIAL,
        payload: {
          employmentId: employment.id,
          targetPositionId: target.id,
          lifecycleEventId: lifecycle.id,
          effectiveAt: change.effectiveAt.toISOString()
        }
      });

      return "applied" as const;
    }).catch(async (error) => {
      if (error instanceof Error && error.message === "TARGET_CLAIM_CONFLICT") {
        const changed = await db.$transaction((tx) => blockScheduledChange(tx, change, now, "TARGET_STATE_CONFLICT"));
        return changed ? "blocked" as const : "skipped" as const;
      }
      throw error;
    });

    if (outcome === "applied") {
      applied += 1;
      notificationsQueued += 1;
    } else if (outcome === "blocked") {
      blocked += 1;
      notificationsQueued += 1;
    }
  }

  return {
    due: due.length,
    applied,
    blocked,
    notificationsQueued
  };
}
