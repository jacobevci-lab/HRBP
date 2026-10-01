import {
  CaseActionStatus,
  CaseAppealStatus,
  CompensationChangeStatus,
  LeaveRequestStatus,
  PayrollRunStatus,
  Prisma,
  ServicePriority,
  ServiceRequestStatus,
  TimeEntryStatus,
  WorkflowInstanceStatus,
  WorkflowTaskStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { documentVisibilityWhere } from "@/lib/document-access";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole, visibleHRServiceQueueKeys } from "@/lib/hr-service-access";
import type { RequestContext } from "@/lib/request-context";

export type LifecycleActionKind = "workflow" | "hr-service" | "employee-relations" | "documents" | "leave" | "time-attendance" | "compensation" | "payroll";
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
  secondaryAction?: null | {
    type: "reject-leave";
    requestId: string;
  } | {
    type: "reject-time";
    entryId: string;
  } | {
    type: "reject-compensation";
    changeId: string;
  } | {
    type: "return-requisition";
    requisitionId: string;
  } | {
    type: "return-offer";
    offerId: string;
  } | {
    type: "request-policy-changes";
    policyId: string;
  } | {
    type: "request-workforce-changes";
    scenarioId: string;
  } | {
    type: "retire-workflow-definition";
    definitionId: string;
  } | {
    type: "return-engagement-draft";
    campaignId: string;
  };
  action: null | {
    type: "complete-workflow";
    instanceId: string;
    taskId: string;
  } | {
    type: "approve-leave";
    requestId: string;
  } | {
    type: "approve-time";
    entryId: string;
  } | {
    type: "approve-compensation";
    changeId: string;
  } | {
    type: "apply-compensation";
    changeId: string;
  } | {
    type: "approve-payroll";
    runId: string;
  } | {
    type: "mark-payroll-paid";
    runId: string;
  } | {
    type: "approve-requisition";
    requisitionId: string;
  } | {
    type: "approve-offer";
    offerId: string;
  } | {
    type: "approve-policy";
    policyId: string;
  } | {
    type: "approve-workforce-scenario";
    scenarioId: string;
  } | {
    type: "activate-workflow-definition";
    definitionId: string;
  } | {
    type: "open-engagement-campaign";
    campaignId: string;
  } | {
    type: "close-engagement-campaign";
    campaignId: string;
  } | {
    type: "begin-dsr-verification";
    dsrId: string;
  } | {
    type: "verify-dsr";
    dsrId: string;
  } | {
    type: "wait-dsr";
    dsrId: string;
  } | {
    type: "resume-dsr";
    dsrId: string;
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

function dayLabel(value: Date) {
  return value.toISOString().slice(0, 10);
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
      href: `/module/employee-relations?q=${encodeURIComponent(caseNumbers.get(row.caseId) ?? row.caseId)}&action=${encodeURIComponent(row.id)}`,
      subjectType: "CaseAction",
      subjectId: row.id,
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
      href: `/module/employee-relations?q=${encodeURIComponent(caseNumbers.get(row.caseId) ?? row.caseId)}&appeal=${encodeURIComponent(row.id)}`,
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

async function documentItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "documents:read")) return [];

  const visibility = await documentVisibilityWhere(db, ctx);
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 30);

  const rows = await db.documentRecord.findMany({
    where: {
      AND: [visibility, { expiresAt: { not: null, lte: horizon } }]
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      fileName: true,
      purpose: true,
      status: true,
      expiresAt: true,
      createdAt: true
    }
  });

  return rows.map((row): LifecycleActionItem => ({
    id: `documents:${row.id}`,
    kind: "documents",
    title: row.fileName,
    subtitle: row.purpose || "Document lifecycle review",
    module: "documents",
    href: `/module/documents?document=${encodeURIComponent(row.id)}`,
    subjectType: "DocumentRecord",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    urgency: urgencyForDueDate(row.expiresAt, "normal"),
    action: null
  }));
}

async function leaveApprovalItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "leave:approve")) return [];
  const scope = await resolveEmploymentScope(db, ctx);
  const rows = await db.leaveRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: LeaveRequestStatus.PENDING,
      ...employmentIdFilter(scope),
      ...(ctx.employmentId ? { employmentId: { ...(scope === null ? {} : { in: scope }), not: ctx.employmentId } } : {})
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      units: true,
      createdAt: true,
      leaveType: { select: { name: true, unit: true } },
      employment: { select: { person: { select: { givenName: true, familyName: true } } } }
    }
  });

  return rows.map((row): LifecycleActionItem => ({
    id: `leave:${row.id}`,
    kind: "leave",
    title: `Leave approval · ${row.employment.person.givenName} ${row.employment.person.familyName}`,
    subtitle: `${row.leaveType.name} · ${String(row.units)} ${row.leaveType.unit.toLowerCase()}`,
    module: "leave",
    href: `/module/leave?request=${encodeURIComponent(row.id)}`,
    subjectType: "LeaveRequest",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.startsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    urgency: urgencyForDueDate(row.startsAt, "warning"),
    action: { type: "approve-leave", requestId: row.id },
    secondaryAction: { type: "reject-leave", requestId: row.id }
  }));
}

async function timeApprovalItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "time:approve")) return [];
  const scope = await resolveEmploymentScope(db, ctx);
  const rows = await db.timeEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: TimeEntryStatus.SUBMITTED,
      ...employmentIdFilter(scope),
      ...(ctx.employmentId ? { employmentId: { ...(scope === null ? {} : { in: scope }), not: ctx.employmentId } } : {})
    },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      workDate: true,
      minutes: true,
      overtimeMinutes: true,
      createdAt: true,
      employment: { select: { person: { select: { givenName: true, familyName: true } } } }
    }
  });

  return rows.map((row): LifecycleActionItem => ({
    id: `time-attendance:${row.id}`,
    kind: "time-attendance",
    title: `Time approval · ${row.employment.person.givenName} ${row.employment.person.familyName}`,
    subtitle: `${Math.floor(row.minutes / 60)}h ${row.minutes % 60}m${row.overtimeMinutes ? ` · OT ${Math.floor(row.overtimeMinutes / 60)}h ${row.overtimeMinutes % 60}m` : ""}`,
    module: "time-attendance",
    href: `/module/time-attendance?entry=${encodeURIComponent(row.id)}`,
    subjectType: "TimeEntry",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.workDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    urgency: urgencyForDueDate(row.workDate, "warning"),
    action: { type: "approve-time", entryId: row.id },
    secondaryAction: { type: "reject-time", entryId: row.id }
  }));
}

async function compensationItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "compensation:read")) return [];
  const canApprove = can(ctx, "compensation:approve");
  const canApply = can(ctx, "compensation:apply");
  if (!canApprove && !canApply) return [];

  const statuses: CompensationChangeStatus[] = [];
  if (canApprove) statuses.push(CompensationChangeStatus.APPROVAL);
  if (canApply) statuses.push(CompensationChangeStatus.APPROVED);
  const scope = await resolveEmploymentScope(db, ctx);
  const rows = await db.compensationChange.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: statuses },
      requestedById: { not: ctx.actorId },
      ...employmentIdFilter(scope)
    },
    orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      effectiveAt: true,
      createdAt: true,
      employment: { select: { person: { select: { givenName: true, familyName: true } } } }
    }
  });

  return rows.map((row): LifecycleActionItem => ({
    id: `compensation:${row.id}`,
    kind: "compensation",
    title: row.status === CompensationChangeStatus.APPROVAL
      ? `Compensation approval · ${row.employment.person.givenName} ${row.employment.person.familyName}`
      : `Compensation apply · ${row.employment.person.givenName} ${row.employment.person.familyName}`,
    subtitle: `${row.status === CompensationChangeStatus.APPROVAL ? "Independent decision required" : "Approved change ready to apply"} · effective ${dayLabel(row.effectiveAt)}`,
    module: "compensation",
    href: `/module/compensation?change=${encodeURIComponent(row.id)}`,
    subjectType: "CompensationChange",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    urgency: urgencyForDueDate(row.effectiveAt, "warning"),
    action: row.status === CompensationChangeStatus.APPROVAL
      ? { type: "approve-compensation", changeId: row.id }
      : { type: "apply-compensation", changeId: row.id },
    secondaryAction: row.status === CompensationChangeStatus.APPROVAL
      ? { type: "reject-compensation", changeId: row.id }
      : null
  }));
}

async function payrollItems(ctx: RequestContext): Promise<LifecycleActionItem[]> {
  if (!can(ctx, "payroll:read")) return [];
  const canApprove = can(ctx, "payroll:approve");
  const canPay = can(ctx, "payroll:pay");
  if (!canApprove && !canPay) return [];

  const statuses: PayrollRunStatus[] = [];
  if (canApprove) statuses.push(PayrollRunStatus.APPROVAL);
  if (canPay) statuses.push(PayrollRunStatus.APPROVED);
  const rows = await db.payrollRun.findMany({
    where: { tenantId: ctx.tenantId, status: { in: statuses } },
    orderBy: [{ payrollPeriod: { payDate: "asc" } }, { startedAt: "asc" }],
    take: 80,
    select: {
      id: true,
      runNumber: true,
      status: true,
      approvedById: true,
      startedAt: true,
      payrollPeriod: {
        select: {
          code: true,
          payDate: true,
          countryPack: { select: { countryCode: true } }
        }
      }
    }
  });

  const approvalIds = rows.filter((row) => row.status === PayrollRunStatus.APPROVAL).map((row) => row.id);
  const creatorEvents = approvalIds.length ? await db.auditEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      resourceType: "PayrollRun",
      resourceId: { in: approvalIds },
      action: "payroll-run.created"
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { resourceId: true, actorId: true }
  }) : [];
  const creators = new Map<string, string | null>();
  for (const event of creatorEvents) if (!creators.has(event.resourceId)) creators.set(event.resourceId, event.actorId);

  return rows.filter((row) => {
    if (row.status === PayrollRunStatus.APPROVAL) return canApprove && creators.get(row.id) !== ctx.actorId;
    if (row.status === PayrollRunStatus.APPROVED) return canPay && row.approvedById !== ctx.actorId;
    return false;
  }).map((row): LifecycleActionItem => ({
    id: `payroll:${row.id}`,
    kind: "payroll",
    title: row.status === PayrollRunStatus.APPROVAL ? "Payroll approval" : "Payroll payment completion",
    subtitle: `${row.payrollPeriod.countryPack.countryCode} · ${row.payrollPeriod.code} · run #${row.runNumber}`,
    module: "payroll",
    href: `/module/payroll?run=${encodeURIComponent(row.id)}`,
    subjectType: "PayrollRun",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.payrollPeriod.payDate.toISOString(),
    createdAt: row.startedAt.toISOString(),
    urgency: urgencyForDueDate(row.payrollPeriod.payDate, "warning"),
    action: row.status === PayrollRunStatus.APPROVAL
      ? { type: "approve-payroll", runId: row.id }
      : { type: "mark-payroll-paid", runId: row.id }
  }));
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
  const [workflows, hrService, employeeRelations, documents, leave, timeAttendance, compensation, payroll] = await Promise.all([
    workflowItems(ctx),
    hrServiceItems(ctx),
    employeeRelationsItems(ctx),
    documentItems(ctx),
    leaveApprovalItems(ctx),
    timeApprovalItems(ctx),
    compensationItems(ctx),
    payrollItems(ctx)
  ]);
  const items = [...workflows, ...hrService, ...employeeRelations, ...documents, ...leave, ...timeAttendance, ...compensation, ...payroll].sort(sortItems).slice(0, 300);
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
      employeeRelations: items.filter((item) => item.kind === "employee-relations").length,
      documents: items.filter((item) => item.kind === "documents").length,
      leave: items.filter((item) => item.kind === "leave").length,
      timeAttendance: items.filter((item) => item.kind === "time-attendance").length,
      compensation: items.filter((item) => item.kind === "compensation").length,
      payroll: items.filter((item) => item.kind === "payroll").length
    },
    generatedAt: new Date(now).toISOString()
  };
}
