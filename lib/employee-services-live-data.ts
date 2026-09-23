import {
  AllegationStatus,
  CaseActionStatus,
  CaseAppealStatus,
  CaseStatus,
  PlatformRole,
  PolicyAssignmentStatus,
  PolicyExceptionStatus,
  PolicyStatus,
  Prisma,
  ServiceRequestStatus,
  WorkflowDefinitionStatus,
  WorkflowInstanceStatus,
  WorkflowTaskStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { canManageHRServiceQueues, hrServiceRequestWhere, visibleHRServiceQueueKeys } from "@/lib/hr-service-access";
import type { RequestContext } from "@/lib/request-context";

function enumLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}
function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(value);
}
function percent(value: number, total: number) { return total ? Math.round((value / total) * 1000) / 10 : 0; }
function ageLabel(from: Date, to = new Date()) {
  const minutes = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function dueLabel(value: Date | null, now = new Date()) {
  if (!value) return "No SLA";
  const minutes = Math.floor((value.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) return `${ageLabel(value, now)} overdue`;
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 2_880) return `${Math.floor(minutes / 60)}h left`;
  return `${Math.floor(minutes / 1_440)}d left`;
}
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
function durationLabel(minutes: number) {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export async function getEmployeeRelationsLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const cases = await db.employeeCase.findMany({
      where: { tenantId: ctx.tenantId, OR: [{ ownerUserId: ctx.actorId }, { assignments: { some: { user: { is: { id: ctx.actorId, tenantId: ctx.tenantId, active: true } } } } }] },
      orderBy: { openedAt: "desc" }, take: 100,
      select: { id: true, caseNumber: true, caseType: true, title: true, status: true, openedAt: true, closedAt: true, classification: true }
    });
    const caseIds = cases.map((record) => record.id);
    if (!caseIds.length) return { openCases: 0, activeAllegations: 0, openActions: 0, activeAppeals: 0, findings: 0, rows: [] as Array<Record<string, unknown>> };
    const [allegations, findings, actions, appeals] = await Promise.all([
      db.caseAllegation.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { caseId: true, status: true } }),
      db.caseFinding.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { caseId: true } }),
      db.caseAction.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { caseId: true, status: true } }),
      db.caseAppeal.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { caseId: true, status: true } })
    ]);
    const activeCaseStatuses = new Set<CaseStatus>([CaseStatus.DRAFT, CaseStatus.OPEN, CaseStatus.INVESTIGATING, CaseStatus.ACTION_REQUIRED]);
    const activeAllegations = new Set<AllegationStatus>([AllegationStatus.OPEN, AllegationStatus.INVESTIGATING]);
    const openActions = new Set<CaseActionStatus>([CaseActionStatus.OPEN, CaseActionStatus.IN_PROGRESS]);
    const activeAppeals = new Set<CaseAppealStatus>([CaseAppealStatus.SUBMITTED, CaseAppealStatus.REVIEWING]);
    return {
      openCases: cases.filter((record) => activeCaseStatuses.has(record.status)).length,
      activeAllegations: allegations.filter((record) => activeAllegations.has(record.status)).length,
      openActions: actions.filter((record) => openActions.has(record.status)).length,
      activeAppeals: appeals.filter((record) => activeAppeals.has(record.status)).length,
      findings: findings.length,
      rows: cases.map((record) => ({
        id: record.id, caseNumber: record.caseNumber, caseType: record.caseType, title: record.title,
        status: enumLabel(record.status), age: ageLabel(record.openedAt, record.closedAt ?? new Date()), openedAt: formatDate(record.openedAt),
        findings: findings.filter((item) => item.caseId === record.id).length,
        openActions: actions.filter((item) => item.caseId === record.id && openActions.has(item.status)).length,
        phase: record.status === CaseStatus.INVESTIGATING ? "Investigation" : record.status === CaseStatus.ACTION_REQUIRED ? "Corrective action" : record.status === CaseStatus.RESOLVED ? "Closure" : record.status === CaseStatus.CLOSED ? "Closed" : allegations.some((item) => item.caseId === record.id) ? "Triage" : "Intake"
      }))
    };
  });
}

export async function getHRServiceLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const selfService = ctx.role === PlatformRole.EMPLOYEE || ctx.role === PlatformRole.MANAGER;
    const where = await hrServiceRequestWhere(db, ctx);
    const requests = await db.hRServiceRequest.findMany({
      where, orderBy: { createdAt: "desc" }, take: 300,
      select: { id: true, requestNumber: true, category: true, title: true, status: true, priority: true, queue: true, assigneeId: true, slaDueAt: true, firstResponseAt: true, resolvedAt: true, createdAt: true, updatedAt: true }
    });
    const terminal = new Set<ServiceRequestStatus>([ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CLOSED, ServiceRequestStatus.CANCELLED]);
    const open = requests.filter((item) => !terminal.has(item.status));
    const now = new Date();
    const measured = requests.filter((item) => item.slaDueAt);
    const isBreached = (item: typeof requests[number]) => {
      if (!item.slaDueAt) return false;
      const end = item.resolvedAt ?? (terminal.has(item.status) ? item.updatedAt : now);
      return end > item.slaDueAt;
    };
    const breached = measured.filter(isBreached).length;
    const firstResponseMinutes = requests.filter((item) => item.firstResponseAt).map((item) => Math.max(0, Math.round((item.firstResponseAt!.getTime() - item.createdAt.getTime()) / 60_000)));
    const routed = open.filter((item) => item.queue || item.assigneeId).length;

    let queueRows: Array<{ id: string; key: string; name: string; defaultSla: string; owners: string; agents: number; open: number; breached: number; unassigned: number }> = [];
    if (!selfService) {
      const managed = canManageHRServiceQueues(ctx);
      const queueKeys = await visibleHRServiceQueueKeys(db, ctx);
      const queues = await db.hRServiceQueue.findMany({
        where: { tenantId: ctx.tenantId, active: true, ...(managed || queueKeys === null ? {} : { key: { in: queueKeys } }) },
        orderBy: { name: "asc" }, include: { memberships: true }
      });
      const userIds = [...new Set(queues.flatMap((queue) => queue.memberships.map((membership) => membership.userId)))];
      const users = userIds.length ? await db.userAccount.findMany({ where: { tenantId: ctx.tenantId, id: { in: userIds } }, select: { id: true, displayName: true } }) : [];
      const userMap = new Map(users.map((user) => [user.id, user.displayName]));
      queueRows = queues.map((queue) => {
        const queueRequests = open.filter((item) => item.queue === queue.key);
        return {
          id: queue.id,
          key: queue.key,
          name: queue.name,
          defaultSla: queue.defaultSlaMinutes ? durationLabel(queue.defaultSlaMinutes) : "Priority policy",
          owners: queue.memberships.filter((membership) => membership.role === "OWNER").map((membership) => userMap.get(membership.userId) ?? membership.userId).join(", ") || "—",
          agents: queue.memberships.length,
          open: queueRequests.length,
          breached: queueRequests.filter(isBreached).length,
          unassigned: queueRequests.filter((item) => !item.assigneeId).length
        };
      });
    }

    return {
      mode: selfService ? "self" as const : "operations" as const,
      openRequests: open.length,
      slaCompliance: measured.length ? percent(measured.length - breached, measured.length) : 100,
      medianFirstResponse: durationLabel(median(firstResponseMinutes)),
      routedPercent: percent(routed, open.length), breached,
      queueManage: !selfService && canManageHRServiceQueues(ctx), queueRows,
      rows: requests.slice(0, 30).map((item) => ({ id: item.id, requestNumber: item.requestNumber, category: item.category, title: item.title, priority: enumLabel(item.priority), age: ageLabel(item.createdAt, item.resolvedAt ?? now), sla: dueLabel(item.slaDueAt, now), queue: item.queue ?? "Unassigned", status: enumLabel(item.status) }))
    };
  });
}

export async function getPoliciesLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const selfService = ctx.role === PlatformRole.EMPLOYEE || ctx.role === PlatformRole.MANAGER;
    const governance = can(ctx, "policies:write") || can(ctx, "policies:approve");
    const now = new Date();
    const publishedWhere: Prisma.PolicyRecordWhereInput = {
      status: PolicyStatus.PUBLISHED,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
    };
    const where: Prisma.PolicyRecordWhereInput = {
      tenantId: ctx.tenantId,
      ...(governance ? { status: { not: PolicyStatus.RETIRED } } : publishedWhere),
      ...(selfService ? (ctx.employmentId ? { assignments: { some: { employmentId: ctx.employmentId } } } : { id: "__no_employment__" }) : {})
    };
    const policies = await db.policyRecord.findMany({
      where, orderBy: [{ reviewDueAt: "asc" }, { code: "asc" }], take: 200,
      select: {
        id: true, code: true, title: true, version: true, status: true, jurisdiction: true, audience: true, ownerId: true, approvedById: true, reviewDueAt: true, effectiveFrom: true,
        assignments: { ...(selfService && ctx.employmentId ? { where: { employmentId: ctx.employmentId } } : {}), select: { status: true, dueAt: true } },
        exceptions: governance ? { select: { status: true, active: true, expiresAt: true } } : false
      }
    });
    const due60 = new Date(now); due60.setDate(due60.getDate() + 60);
    const assignments = policies.flatMap((policy) => policy.assignments);
    const acknowledged = assignments.filter((assignment) => assignment.status === PolicyAssignmentStatus.ACKNOWLEDGED || assignment.status === PolicyAssignmentStatus.WAIVED).length;
    const pending = assignments.filter((assignment) => assignment.status === PolicyAssignmentStatus.PENDING || assignment.status === PolicyAssignmentStatus.OVERDUE).length;
    const published = policies.filter((policy) => policy.status === PolicyStatus.PUBLISHED).length;
    const activeExceptions = governance ? policies.reduce((sum, policy) => sum + (Array.isArray(policy.exceptions) ? policy.exceptions.filter((item) => item.status === PolicyExceptionStatus.APPROVED && item.active && (!item.expiresAt || item.expiresAt > now)).length : 0), 0) : 0;
    const pendingExceptions = governance ? policies.reduce((sum, policy) => sum + (Array.isArray(policy.exceptions) ? policy.exceptions.filter((item) => item.status === PolicyExceptionStatus.REQUESTED).length : 0), 0) : 0;
    return {
      mode: selfService ? "self" as const : governance ? "governance" as const : "read" as const,
      canWrite: can(ctx, "policies:write"), canApprove: can(ctx, "policies:approve"), actorId: ctx.actorId,
      published, pendingApprovals: policies.filter((policy) => policy.status === PolicyStatus.REVIEW).length,
      reviewDue: policies.filter((policy) => policy.reviewDueAt && policy.reviewDueAt >= now && policy.reviewDueAt <= due60).length,
      acknowledgement: percent(acknowledged, assignments.length), pending, activeExceptions, pendingExceptions,
      rows: policies.map((policy) => ({
        id: policy.id, code: policy.code, title: policy.title, version: policy.version, jurisdiction: policy.jurisdiction ?? "Global", audience: policy.audience ?? "Configured population",
        acknowledged: percent(policy.assignments.filter((assignment) => assignment.status === PolicyAssignmentStatus.ACKNOWLEDGED || assignment.status === PolicyAssignmentStatus.WAIVED).length, policy.assignments.length),
        assignmentStatus: selfService ? enumLabel(policy.assignments[0]?.status ?? PolicyAssignmentStatus.PENDING) : null,
        reviewDueAt: formatDate(policy.reviewDueAt), effectiveFrom: formatDate(policy.effectiveFrom), status: enumLabel(policy.status), rawStatus: policy.status, ownerId: policy.ownerId, approvedById: policy.approvedById
      }))
    };
  });
}

export async function getWorkflowsLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const definitions = await db.workflowDefinition.findMany({
      where: { tenantId: ctx.tenantId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 150,
      select: { id: true, key: true, name: true, version: true, triggerType: true, status: true, createdById: true, instances: { orderBy: { startedAt: "desc" }, take: 300, select: { id: true, status: true, startedAt: true, completedAt: true, failedAt: true, tasks: { select: { status: true, dueAt: true } } } } }
    });
    const ownerIds = [...new Set(definitions.map((definition) => definition.createdById).filter(Boolean))];
    const owners = ownerIds.length ? await db.userAccount.findMany({ where: { tenantId: ctx.tenantId, id: { in: ownerIds } }, select: { id: true, displayName: true } }) : [];
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner.displayName]));
    const instances = definitions.flatMap((definition) => definition.instances);
    const tasks = instances.flatMap((instance) => instance.tasks);
    const inFlightStatuses = new Set<WorkflowInstanceStatus>([WorkflowInstanceStatus.PENDING, WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.WAITING]);
    const waitingStatuses = new Set<WorkflowTaskStatus>([WorkflowTaskStatus.READY, WorkflowTaskStatus.IN_PROGRESS]);
    const now = new Date();
    return {
      activeDefinitions: definitions.filter((definition) => definition.status === WorkflowDefinitionStatus.ACTIVE).length,
      inFlight: instances.filter((instance) => inFlightStatuses.has(instance.status)).length,
      waitingTasks: tasks.filter((task) => waitingStatuses.has(task.status)).length,
      overdueTasks: tasks.filter((task) => task.dueAt && task.dueAt < now && waitingStatuses.has(task.status)).length,
      failed: instances.filter((instance) => instance.status === WorkflowInstanceStatus.FAILED).length + tasks.filter((task) => task.status === WorkflowTaskStatus.FAILED).length,
      rows: definitions.map((definition) => ({ id: definition.id, key: definition.key, name: definition.name, version: definition.version, trigger: definition.triggerType, instances: definition.instances.length, inFlight: definition.instances.filter((instance) => inFlightStatuses.has(instance.status)).length, failures: definition.instances.filter((instance) => instance.status === WorkflowInstanceStatus.FAILED).length + definition.instances.flatMap((instance) => instance.tasks).filter((task) => task.status === WorkflowTaskStatus.FAILED).length, owner: ownerMap.get(definition.createdById) ?? definition.createdById, status: enumLabel(definition.status) }))
    };
  });
}
