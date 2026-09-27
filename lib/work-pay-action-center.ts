import {
  CompensationChangeStatus,
  LeaveRequestStatus,
  PayrollRunStatus,
  TimeEntryStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type WorkPayActionUrgency = "normal" | "warning" | "critical";

export type WorkPayActionCenterItem = {
  id: string;
  kind: "work-pay";
  title: string;
  subtitle: string;
  module: "time-attendance" | "leave" | "compensation" | "payroll";
  href: string;
  subjectType: "TimeEntry" | "LeaveRequest" | "CompensationChange" | "PayrollRun";
  subjectId: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  urgency: WorkPayActionUrgency;
  action: null;
};

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function urgencyFor(dueAt: Date | null, fallback: WorkPayActionUrgency = "warning", now = Date.now()): WorkPayActionUrgency {
  if (!dueAt) return fallback;
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return "warning";
  return fallback;
}

function nextUtcDay(value: Date) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function approvalEmploymentFilter(scope: string[] | null, ownEmploymentId?: string) {
  if (scope === null) return ownEmploymentId ? { employmentId: { not: ownEmploymentId } } : {};
  const allowed = ownEmploymentId ? scope.filter((id) => id !== ownEmploymentId) : scope;
  return { employmentId: { in: allowed } };
}

async function timeApprovalItems(ctx: RequestContext, scope: string[] | null): Promise<WorkPayActionCenterItem[]> {
  if (!can(ctx, "time:read") || !can(ctx, "time:approve")) return [];

  const rows = await db.timeEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: TimeEntryStatus.SUBMITTED,
      ...approvalEmploymentFilter(scope, ctx.employmentId)
    },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    take: 75,
    select: {
      id: true,
      workDate: true,
      status: true,
      createdAt: true,
      employment: { select: { person: { select: { givenName: true, familyName: true } } } }
    }
  });

  return rows.map((row) => {
    const dueAt = nextUtcDay(row.workDate);
    return {
      id: `work-pay:time:${row.id}`,
      kind: "work-pay",
      title: "Time approval",
      subtitle: `${row.employment.person.givenName} ${row.employment.person.familyName} · ${row.workDate.toISOString().slice(0, 10)}`,
      module: "time-attendance",
      href: `/module/time-attendance?focus=${encodeURIComponent(row.id)}`,
      subjectType: "TimeEntry",
      subjectId: row.id,
      status: statusLabel(row.status),
      dueAt: dueAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      urgency: urgencyFor(dueAt),
      action: null
    };
  });
}

async function leaveApprovalItems(ctx: RequestContext, scope: string[] | null): Promise<WorkPayActionCenterItem[]> {
  if (!can(ctx, "leave:read") || !can(ctx, "leave:approve")) return [];

  const rows = await db.leaveRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: LeaveRequestStatus.PENDING,
      ...approvalEmploymentFilter(scope, ctx.employmentId)
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 75,
    select: {
      id: true,
      startsAt: true,
      status: true,
      employment: { select: { person: { select: { givenName: true, familyName: true } } } },
      leaveType: { select: { name: true } }
    }
  });

  return rows.map((row) => ({
    id: `work-pay:leave:${row.id}`,
    kind: "work-pay",
    title: "Leave approval",
    subtitle: `${row.employment.person.givenName} ${row.employment.person.familyName} · ${row.leaveType.name}`,
    module: "leave",
    href: `/module/leave?focus=${encodeURIComponent(row.id)}`,
    subjectType: "LeaveRequest",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.startsAt.toISOString(),
    createdAt: row.startsAt.toISOString(),
    urgency: urgencyFor(row.startsAt),
    action: null
  }));
}

async function compensationItems(ctx: RequestContext, scope: string[] | null): Promise<WorkPayActionCenterItem[]> {
  if (!can(ctx, "compensation:read")) return [];
  const canApprove = can(ctx, "compensation:approve");
  const canApply = can(ctx, "compensation:apply");
  if (!canApprove && !canApply) return [];

  const statuses = [
    ...(canApprove ? [CompensationChangeStatus.APPROVAL] : []),
    ...(canApply ? [CompensationChangeStatus.APPROVED] : [])
  ];

  const rows = await db.compensationChange.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: statuses },
      requestedById: { not: ctx.actorId },
      ...employmentIdFilter(scope)
    },
    orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
    take: 50,
    select: {
      id: true,
      status: true,
      effectiveAt: true,
      createdAt: true,
      employment: { select: { person: { select: { givenName: true, familyName: true } } } }
    }
  });

  return rows.map((row) => ({
    id: `work-pay:compensation:${row.id}`,
    kind: "work-pay",
    title: row.status === CompensationChangeStatus.APPROVAL ? "Compensation approval" : "Compensation apply",
    subtitle: `${row.employment.person.givenName} ${row.employment.person.familyName} · restricted compensation change`,
    module: "compensation",
    href: `/module/compensation?focus=${encodeURIComponent(row.id)}`,
    subjectType: "CompensationChange",
    subjectId: row.id,
    status: statusLabel(row.status),
    dueAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    urgency: urgencyFor(row.effectiveAt),
    action: null
  }));
}

async function payrollItems(ctx: RequestContext): Promise<WorkPayActionCenterItem[]> {
  if (!can(ctx, "payroll:read")) return [];
  const canApprove = can(ctx, "payroll:approve");
  const canPay = can(ctx, "payroll:pay");
  if (!canApprove && !canPay) return [];

  const statuses = [
    ...(canApprove ? [PayrollRunStatus.APPROVAL] : []),
    ...(canPay ? [PayrollRunStatus.APPROVED] : [])
  ];

  const rows = await db.payrollRun.findMany({
    where: { tenantId: ctx.tenantId, status: { in: statuses } },
    orderBy: [{ payrollPeriod: { payDate: "asc" } }, { runNumber: "asc" }],
    take: 40,
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
  const creatorAudits = approvalIds.length ? await db.auditEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      resourceType: "PayrollRun",
      resourceId: { in: approvalIds },
      action: "payroll-run.created"
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { resourceId: true, actorId: true }
  }) : [];
  const creatorByRun = new Map<string, string>();
  for (const audit of creatorAudits) if (!creatorByRun.has(audit.resourceId)) creatorByRun.set(audit.resourceId, audit.actorId);

  return rows.flatMap((row): WorkPayActionCenterItem[] => {
    if (row.status === PayrollRunStatus.APPROVAL && (!canApprove || creatorByRun.get(row.id) === ctx.actorId)) return [];
    if (row.status === PayrollRunStatus.APPROVED && (!canPay || row.approvedById === ctx.actorId)) return [];
    const dueAt = row.payrollPeriod.payDate;
    return [{
      id: `work-pay:payroll:${row.id}`,
      kind: "work-pay",
      title: row.status === PayrollRunStatus.APPROVAL ? "Payroll approval" : "Payroll payment control",
      subtitle: `${row.payrollPeriod.countryPack.countryCode} · ${row.payrollPeriod.code} · run #${row.runNumber}`,
      module: "payroll",
      href: `/module/payroll?focus=${encodeURIComponent(row.id)}`,
      subjectType: "PayrollRun",
      subjectId: row.id,
      status: statusLabel(row.status),
      dueAt: dueAt?.toISOString() ?? null,
      createdAt: row.startedAt.toISOString(),
      urgency: urgencyFor(dueAt, "warning"),
      action: null
    }];
  });
}

export async function getWorkPayActionCenterItems(ctx: RequestContext): Promise<WorkPayActionCenterItem[]> {
  const needsEmploymentScope = can(ctx, "time:approve") || can(ctx, "leave:approve") || can(ctx, "compensation:approve") || can(ctx, "compensation:apply");
  const scope = needsEmploymentScope ? await resolveEmploymentScope(db, ctx) : [];
  const [time, leave, compensation, payroll] = await Promise.all([
    timeApprovalItems(ctx, scope),
    leaveApprovalItems(ctx, scope),
    compensationItems(ctx, scope),
    payrollItems(ctx)
  ]);
  return [...time, ...leave, ...compensation, ...payroll].slice(0, 150);
}
