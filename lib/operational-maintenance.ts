import { DataClassification, PlatformRole, PolicyExceptionStatus, PolicyStatus, ServiceQueueRole, ServiceRequestStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { runtimeNumber } from "@/lib/runtime-env";
import type { RequestContext } from "@/lib/request-context";

const terminalServiceStatuses = [ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CLOSED, ServiceRequestStatus.CANCELLED];

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:operational-maintenance",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled operational maintenance"
  };
}

function escalationTarget(dueAt: Date, now: Date) {
  const warningMinutes = Math.max(15, Math.floor(runtimeNumber("HRBP_SERVICE_SLA_WARNING_MINUTES", 120)));
  const severeMinutes = Math.max(60, Math.floor(runtimeNumber("HRBP_SERVICE_SLA_SEVERE_MINUTES", 1440)));
  const deltaMinutes = Math.floor((dueAt.getTime() - now.getTime()) / 60_000);
  if (deltaMinutes <= -severeMinutes) return { level: 3, reason: `SLA breached by at least ${severeMinutes} minutes` };
  if (deltaMinutes <= 0) return { level: 2, reason: "SLA breached" };
  if (deltaMinutes <= warningMinutes) return { level: 1, reason: `SLA due within ${warningMinutes} minutes` };
  return { level: 0, reason: "" };
}

async function escalateServiceRequests(now: Date) {
  const maxBatch = Math.min(1000, Math.max(50, Math.floor(runtimeNumber("HRBP_MAINTENANCE_BATCH_SIZE", 500))));
  const candidates = await db.hRServiceRequest.findMany({
    where: {
      slaDueAt: { not: null },
      status: { notIn: terminalServiceStatuses }
    },
    orderBy: { slaDueAt: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      queue: true,
      assigneeId: true,
      slaDueAt: true,
      escalationLevel: true
    }
  });
  let escalated = 0;
  let autoAssigned = 0;

  for (const candidate of candidates) {
    if (!candidate.slaDueAt) continue;
    const target = escalationTarget(candidate.slaDueAt, now);
    if (target.level <= candidate.escalationLevel) continue;

    const changed = await db.$transaction(async (tx) => {
      let assigneeId = candidate.assigneeId;
      if (target.level >= 2 && !assigneeId && candidate.queue) {
        const queue = await tx.hRServiceQueue.findFirst({
          where: { tenantId: candidate.tenantId, key: candidate.queue, active: true },
          select: { id: true }
        });
        if (queue) {
          const owner = await tx.hRServiceQueueMembership.findFirst({
            where: { tenantId: candidate.tenantId, queueId: queue.id, role: ServiceQueueRole.OWNER },
            orderBy: { createdAt: "asc" },
            select: { userId: true }
          });
          if (owner) assigneeId = owner.userId;
        }
      }

      const result = await tx.hRServiceRequest.updateMany({
        where: { id: candidate.id, tenantId: candidate.tenantId, escalationLevel: candidate.escalationLevel, status: { notIn: terminalServiceStatuses } },
        data: {
          escalationLevel: target.level,
          escalationReason: target.reason,
          escalatedAt: now,
          ...(assigneeId && !candidate.assigneeId ? { assigneeId } : {})
        }
      });
      if (result.count !== 1) return { changed: false, assigned: false };
      await appendAudit(tx, systemContext(candidate.tenantId), {
        action: `hr-service.escalated-level-${target.level}`,
        resourceType: "HRServiceRequest",
        resourceId: candidate.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: assigneeId && !candidate.assigneeId ? `${target.reason}; auto-routed to queue owner` : target.reason
      });
      return { changed: true, assigned: Boolean(assigneeId && !candidate.assigneeId) };
    });
    if (changed.changed) escalated += 1;
    if (changed.assigned) autoAssigned += 1;
  }
  return { escalated, autoAssigned };
}

async function expirePolicyExceptions(now: Date) {
  const rows = await db.policyException.findMany({
    where: { status: PolicyExceptionStatus.APPROVED, active: true, expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: 500,
    select: { id: true, tenantId: true }
  });
  let expired = 0;
  for (const row of rows) {
    const changed = await db.$transaction(async (tx) => {
      const result = await tx.policyException.updateMany({
        where: { id: row.id, tenantId: row.tenantId, status: PolicyExceptionStatus.APPROVED, active: true, expiresAt: { lte: now } },
        data: { status: PolicyExceptionStatus.EXPIRED, active: false, decidedAt: now, decisionNote: "Automatically expired at configured exception end date" }
      });
      if (result.count !== 1) return false;
      await appendAudit(tx, systemContext(row.tenantId), {
        action: "policy.exception-expired",
        resourceType: "PolicyException",
        resourceId: row.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Automatic policy exception expiry"
      });
      return true;
    });
    if (changed) expired += 1;
  }
  return expired;
}

async function retirePolicies(now: Date) {
  const policies = await db.policyRecord.findMany({
    where: { status: PolicyStatus.PUBLISHED, effectiveTo: { lte: now } },
    orderBy: { effectiveTo: "asc" },
    take: 200,
    select: { id: true, tenantId: true }
  });
  let retired = 0;
  let exceptionClosures = 0;

  for (const policy of policies) {
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.policyRecord.updateMany({
        where: { id: policy.id, tenantId: policy.tenantId, status: PolicyStatus.PUBLISHED, effectiveTo: { lte: now } },
        data: { status: PolicyStatus.RETIRED }
      });
      if (updated.count !== 1) return { retired: false, closed: 0 };

      const exceptions = await tx.policyException.findMany({
        where: { tenantId: policy.tenantId, policyId: policy.id, status: { in: [PolicyExceptionStatus.REQUESTED, PolicyExceptionStatus.APPROVED] } },
        select: { id: true, status: true }
      });
      for (const exception of exceptions) {
        const nextStatus = exception.status === PolicyExceptionStatus.REQUESTED ? PolicyExceptionStatus.REJECTED : PolicyExceptionStatus.REVOKED;
        await tx.policyException.update({
          where: { id: exception.id },
          data: { status: nextStatus, active: false, decidedAt: now, decisionNote: "Closed automatically because the governing policy was retired" }
        });
        await appendAudit(tx, systemContext(policy.tenantId), {
          action: nextStatus === PolicyExceptionStatus.REJECTED ? "policy.exception-rejected-on-retirement" : "policy.exception-revoked-on-retirement",
          resourceType: "PolicyException",
          resourceId: exception.id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: "Policy retirement closed dependent exception"
        });
      }
      await appendAudit(tx, systemContext(policy.tenantId), {
        action: "policy.retired",
        resourceType: "PolicyRecord",
        resourceId: policy.id,
        classification: DataClassification.INTERNAL,
        purpose: "Policy effective period ended"
      });
      return { retired: true, closed: exceptions.length };
    });
    if (result.retired) retired += 1;
    exceptionClosures += result.closed;
  }
  return { retired, exceptionClosures };
}

export async function runOperationalMaintenance() {
  const startedAt = new Date();
  const [service, expiredExceptions, retiredPolicies] = await Promise.all([
    escalateServiceRequests(startedAt),
    expirePolicyExceptions(startedAt),
    retirePolicies(startedAt)
  ]);
  return {
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    service,
    policy: {
      expiredExceptions,
      retiredPolicies: retiredPolicies.retired,
      retirementExceptionClosures: retiredPolicies.exceptionClosures
    }
  };
}
