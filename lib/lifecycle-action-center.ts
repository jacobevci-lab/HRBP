import {
  CaseActionStatus,
  CaseAppealStatus,
  PlatformRole,
  Prisma,
  ServicePriority,
  ServiceRequestStatus,
  WorkflowInstanceStatus,
  WorkflowTaskStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole, visibleHRServiceQueueKeys } from "@/lib/hr-service-access";
import type { RequestContext } from "@/lib/request-context";

export type LifecycleActionKind = "workflow" | "hr-service" | "employee-relations";
export type LifecycleActionUrgency = "normal" | "warning" | "critical";

export type LifecycleActionItem = {
  id: string;
  kind: LifecycleActionKind;
  title: string;
  subtitle: string;
  module: string;
  href: string;
  subjectType: string;
  subjectId: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  urgency: LifecycleActionUrgency;
  action: null | {
    type: "complete-workflow";
    instanceId: string;
    taskId: string;
  };
};

function urgencyForDueDate(dueAt: Date | null, fallback: LifecycleActionUrgency = "normal", now = Date.now()): LifecycleActionUrgency {
  if (!dueAt) return fallback;
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return fallback === "critical" ? "critical" : "warning";
  return fallback;
}

function serviceUrgency(priority: ServicePriority, dueAt: Date | null, escalationLevel: number) {
  const fallback: LifecycleActionUrgency = escalationLevel > 0 || priority === ServicePriority.CRITICAL
    ? "critical"
    : priority === ServicePriority.HIGH
      ? "warning"
      : "normal";
  return urgencyForDueDate(dueAt, fallback);
}

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

async function workflowItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  const scopes: Prisma.WorkflowTaskWhereInput[] = [
    { assigneeId: ctx.actorId },
    { assigneeId: null, assigneeRole: ctx.role }
  ];
  if (can(ctx, "workflows:run")) scopes.push({ assigneeId: null, assigneeRole: null });

  const rows = await db.workflowTask.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: [WorkflowTaskStatus.READY, WorkflowTaskStatus.IN_PROGRESS] },
      instance: { status: { in: [WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.WAITING] } },
      OR: scopes
    },
    take: 150,
    select: {
      id: true,
      stepKey: true,
      name: true,
      status: true,
      dueAt: true,
      startedAt: true,
      instance: {
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          startedAt: true,
          definition: { select: { key: true, name: true, version: true } }
        }
      }
    }
  });

  return rows.map((row) => ({
    id: `workflow:${row.id}`,
    kind: "workflow",
    title: row.name,
    subtitle: `${row.instance.definition.name} · ${row.stepKey}`,
    module: "workflows",
    href: `/module/workflows?task=${encodeURIComponent(row.id)}&instance=${encodeURIComponent(row.instance.id)}`,
    subjectType: row.instance.subjectType,
    subjectId: row.instance.subjectId,
    status: statusLabel(row.status),
    dueAt: row.dueAt?.toISOString() ?? null,
    createdAt: (row.startedAt ?? row.instance.startedAt).toISOString(),
    urgency: urgencyForDueDate(row.dueAt),
    action: { type: "complete-workflow", instanceId: row.instance.id, taskId: row.id }
  }));
}

async function hrServiceItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "hr-service:read")) return [];

  const access = await hrServiceRequestWhere(db, ctx);
  const selfService = isHRServiceSelfServiceRole(ctx.role);
  const queueKeys = selfService ? [] : await visibleHRServiceQueueKeys(db, ctx);
  const activeStatuses = [
    ServiceRequestStatus.OPEN,
    ServiceRequestStatus.TRIAGE,
    ServiceRequestStatus.IN_PROGRESS,
    ServiceRequestStatus.WAITING_EMPLOYEE,
    ServiceRequestStatus.WAITING_THIRD_PARTY
  ];

  const attentionScope: Prisma.HRServiceRequestWhereInput = selfService
    ? { requestorId: ctx.actorId, status: ServiceRequestStatus.WAITING_EMPLOYEE }
    : {
        status: { in: activeStatuses },
        OR: [
          { assigneeId: ctx.actorId },
          ...(queueKeys === null ? [{ assigneeId: null }] : queueKeys.length ? [{ assigneeId: null, queue: { in: queueKeys } }] : []),
          { escalationLevel: { gt: 0 } },
          { priority: { in: [ServicePriority.HIGH, ServicePriority.CRITICAL] } }
        ]
      };

  const rows = await db.hRServiceRequest.findMany({
    where: { AND: [access, attentionScope] },
    orderBy: [{ slaDueAt: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      requestNumber: true,
      title: true,
      category: true,
      status: true,
      priority: true,
      queue: true,
      slaDueAt: true,
      escalationLevel: true,
      createdAt: true
    }
  });

  return rows.map((row) => ({
    id: `hr-service:${row.id}`,
    kind: "hr-service",
    title: selfService && row.status === ServiceRequestStatus.WAITING_EMPLOYEE
      ? `Response needed · ${row.requestNumber}`
      : `${row.requestNumber} · ${row.title}`,
    subtitle: `${row.category}${row.queue ? ` · ${row.queue}` : ""}`,
    module: "hr-service",
    href: `/module/hr-service?q=${encodeURIComponent(row.requestNumber)}`,
    subjectType: "HRServiceRequest",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.slaDueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    urgency: serviceUrgency(row.priority, row.slaDueAt, row.escalationLevel),
    action: null
  }));
}

async function employeeRelationsItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "cases:read")) return [];

  const caseScope: Prisma.EmployeeCaseWhereInput = {
    tenantId: ctx.tenantId,
    OR: [
      { ownerUserId: ctx.actorId },
      { assignments: { some: { user: { is: { id: ctx.actorId, tenantId: ctx.tenantId, active: true } } } } }
    ]
  };

  const cases = await db.employeeCase.findMany({
    where: caseScope,
    take: 200,
    select: { id: true, caseNumber: true }
  });
  const caseIds = cases.map((record) => record.id);
  if (!caseIds.length) return [];
  const caseNumbers = new Map(cases.map((record) => [record.id, record.caseNumber]));

  const [actions, appeals] = await Promise.all([
    db.caseAction.findMany({
      where: {
        tenantId: ctx.tenantId,
        caseId: { in: caseIds },
        ownerId: ctx.actorId,
        status: { in: [CaseActionStatus.OPEN, CaseActionStatus.IN_PROGRESS] }
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: { id: true, caseId: true, actionType: true, description: true, status: true, dueAt: true, createdAt: true }
    }),
    db.caseAppeal.findMany({
      where: {
        tenantId: ctx.tenantId,
        caseId: { in: caseIds },
        reviewerId: ctx.actorId,
        status: { in: [CaseAppealStatus.SUBMITTED, CaseAppealStatus.REVIEWING] }
      },
      orderBy: { submittedAt: "asc" },
      take: 50,
      select: { id: true, caseId: true, status: true, submittedAt: true }
    })
  ]);

  return [
    ...actions.map((row): LifecycleActionItem => ({
      id: `employee-relations:action:${row.id}`,
      kind: "employee-relations",
      title: row.actionType,
      subtitle: `${caseNumbers.get(row.caseId) ?? "Restricted case"} · ${row.description}`,
      module: "employee-relations",
      href: `/module/employee-relations?q=${encodeURIComponent(caseNumbers.get(row.caseId) ?? row.caseId)}`,
      subjectType: "EmployeeCase",
      subjectId: row.caseId,
      status: statusLabel(row.status),
      dueAt: row.dueAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      urgency: urgencyForDueDate(row.dueAt, "warning"),
      action: null
    })),
    ...appeals.map((row): LifecycleActionItem => ({
      id: `employee-relations:appeal:${row.id}`,
      kind: "employee-relations",
      title: "Appeal review",
      subtitle: `${caseNumbers.get(row.caseId) ?? "Restricted case"} · reviewer action required`,
      module: "employee-relations",
      href: `/module/employee-relations?q=${encodeURIComponent(caseNumbers.get(row.caseId) ?? row.caseId)}`,
      subjectType: "EmployeeCaseAppeal",
      subjectId: row.id,
      status: statusLabel(row.status),
      dueAt: null,
      createdAt: row.submittedAt.toISOString(),
      urgency: "warning",
      action: null
    }))
  ];
}

function sortItems(left: LifecycleActionItem, right: LifecycleActionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

export async function getLifecycleActionCenterData(ctx: RequestContext) {
  const [workflows, hrService, employeeRelations] = await Promise.all([
    workflowItems(ctx),
    hrServiceItems(ctx),
    employeeRelationsItems(ctx)
  ]);
  const items = [...workflows, ...hrService, ...employeeRelations].sort(sortItems).slice(0, 250);
  const now = Date.now();
  const soon = now + 24 * 60 * 60 * 1000;

  return {
    items,
    summary: {
      total: items.length,
      overdue: items.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < now).length,
      dueSoon: items.filter((item) => {
        if (!item.dueAt) return false;
        const due = new Date(item.dueAt).getTime();
        return due >= now && due <= soon;
      }).length,
      critical: items.filter((item) => item.urgency === "critical").length,
      workflow: items.filter((item) => item.kind === "workflow").length,
      hrService: items.filter((item) => item.kind === "hr-service").length,
      employeeRelations: items.filter((item) => item.kind === "employee-relations").length
    },
    generatedAt: new Date(now).toISOString()
  };
}
