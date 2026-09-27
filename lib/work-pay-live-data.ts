import { EmploymentStatus, LeaveRequestStatus, PayrollRunStatus, TimeEntryStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier } from "@/lib/input-validation";
import type { RequestContext } from "@/lib/request-context";

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayLabel(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "—";
}

function timeLabel(date: Date | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function decimalNumber(value: { toNumber(): number } | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function isFinalTimeStatus(status: TimeEntryStatus) {
  return status === TimeEntryStatus.APPROVED || status === TimeEntryStatus.LOCKED;
}

function isClosedPayrollStatus(status: PayrollRunStatus) {
  return status === PayrollRunStatus.PAID || status === PayrollRunStatus.CANCELLED;
}

export async function getTimeAttendanceLiveData(ctx: RequestContext, focusId?: string) {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const focus = asIdentifier(focusId);
    const now = new Date();
    const today = startOfUtcDay(now);
    const tomorrow = addUtcDays(today, 1);
    const employmentInclude = {
      select: {
        id: true,
        person: { select: { employeeNumber: true, givenName: true, familyName: true } },
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      }
    } as const;

    const [expected, entries, scheduleAssignments, focusedEntry] = await Promise.all([
      db.employment.count({
        where: {
          tenantId: ctx.tenantId,
          status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE] },
          ...employmentPrimaryKeyFilter(scope)
        }
      }),
      db.timeEntry.findMany({
        where: {
          tenantId: ctx.tenantId,
          workDate: { gte: today, lt: tomorrow },
          ...employmentIdFilter(scope)
        },
        orderBy: [{ status: "asc" }, { startAt: "asc" }],
        include: { employment: employmentInclude },
        take: 250
      }),
      db.workScheduleAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          ...employmentIdFilter(scope)
        },
        select: { employmentId: true }
      }),
      focus ? db.timeEntry.findFirst({
        where: { id: focus, tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
        include: { employment: employmentInclude }
      }) : Promise.resolve(null)
    ]);

    const scheduledEmployments = new Set(scheduleAssignments.map((row) => row.employmentId)).size;
    const exceptions = entries.filter((entry) => !isFinalTimeStatus(entry.status) || !entry.startAt || !entry.endAt).length;
    const overtimeMinutes = entries.reduce((sum, entry) => sum + entry.overtimeMinutes, 0);
    const rowEntries = focus
      ? [...(focusedEntry ? [focusedEntry] : []), ...entries.filter((entry) => entry.id !== focus)]
      : entries;

    return {
      expected,
      recorded: entries.length,
      exceptions,
      overtimeMinutes,
      scheduleCoverage: expected ? Math.min(100, Math.round((scheduledEmployments / expected) * 1000) / 10) : 0,
      focusId: focusedEntry?.id ?? null,
      rows: rowEntries.map((entry) => ({
        id: entry.id,
        employmentId: entry.employmentId,
        employee: `${entry.employment.person.givenName} ${entry.employment.person.familyName}`,
        employeeNumber: entry.employment.person.employeeNumber ?? "—",
        position: entry.employment.position?.title ?? "—",
        organization: entry.employment.position?.orgUnit.name ?? "—",
        startAt: timeLabel(entry.startAt),
        endAt: timeLabel(entry.endAt),
        minutes: entry.minutes,
        overtimeMinutes: entry.overtimeMinutes,
        status: statusLabel(entry.status),
        rawStatus: entry.status,
        source: entry.source ?? "—"
      }))
    };
  });
}

export async function getLeaveLiveData(ctx: RequestContext, focusId?: string) {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const focus = asIdentifier(focusId);
    const now = new Date();
    const today = startOfUtcDay(now);
    const horizon = addUtcDays(today, 60);
    const currentYear = today.getUTCFullYear();
    const requestInclude = {
      leaveType: true,
      employment: {
        select: {
          id: true,
          person: { select: { employeeNumber: true, givenName: true, familyName: true } },
          position: { select: { title: true, orgUnit: { select: { name: true } } } }
        }
      }
    } as const;

    const [requests, balances, awayToday, focusedRequest] = await Promise.all([
      db.leaveRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          startsAt: { lte: horizon },
          endsAt: { gte: today },
          ...employmentIdFilter(scope)
        },
        orderBy: [{ status: "asc" }, { startsAt: "asc" }],
        include: requestInclude,
        take: 250
      }),
      db.leaveBalance.findMany({
        where: { tenantId: ctx.tenantId, periodYear: currentYear, ...employmentIdFilter(scope) },
        include: { leaveType: true }
      }),
      db.leaveRequest.count({
        where: {
          tenantId: ctx.tenantId,
          status: { in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.TAKEN] },
          startsAt: { lte: addUtcDays(today, 1) },
          endsAt: { gte: today },
          ...employmentIdFilter(scope)
        }
      }),
      focus ? db.leaveRequest.findFirst({
        where: { id: focus, tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
        include: requestInclude
      }) : Promise.resolve(null)
    ]);

    const pending = requests.filter((request) => request.status === LeaveRequestStatus.PENDING).length;
    const totalRemaining = balances.reduce((sum, balance) => sum + decimalNumber(balance.opening) + decimalNumber(balance.accrued) + decimalNumber(balance.adjustment) - decimalNumber(balance.used), 0);
    const averageRemaining = balances.length ? Math.round((totalRemaining / balances.length) * 10) / 10 : 0;
    const rowRequests = focus
      ? [...(focusedRequest ? [focusedRequest] : []), ...requests.filter((request) => request.id !== focus)]
      : requests;

    return {
      pending,
      awayToday,
      averageRemaining,
      balanceRecords: balances.length,
      focusId: focusedRequest?.id ?? null,
      rows: rowRequests.map((request) => ({
        id: request.id,
        employmentId: request.employmentId,
        employee: `${request.employment.person.givenName} ${request.employment.person.familyName}`,
        employeeNumber: request.employment.person.employeeNumber ?? "—",
        position: request.employment.position?.title ?? "—",
        organization: request.employment.position?.orgUnit.name ?? "—",
        leaveType: request.leaveType.name,
        unit: request.leaveType.unit,
        startsAt: dayLabel(request.startsAt),
        endsAt: dayLabel(request.endsAt),
        units: decimalNumber(request.units),
        status: statusLabel(request.status),
        rawStatus: request.status,
        approverId: request.approverId ?? "—"
      }))
    };
  });
}

export async function getPayrollLiveData(ctx: RequestContext, focusId?: string) {
  return withDb(async (db) => {
    const focus = asIdentifier(focusId);
    const runInclude = {
      payrollPeriod: { include: { countryPack: true } },
      results: { select: { grossPay: true, netPay: true, employerCost: true } }
    } as const;
    const [packs, runs, focusedRun] = await Promise.all([
      db.payrollCountryPack.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: { countryCode: "asc" }
      }),
      db.payrollRun.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { startedAt: "desc" },
        include: runInclude,
        take: 40
      }),
      focus ? db.payrollRun.findFirst({
        where: { id: focus, tenantId: ctx.tenantId },
        include: runInclude
      }) : Promise.resolve(null)
    ]);

    const displayedRuns = focus
      ? [...(focusedRun ? [focusedRun] : []), ...runs.filter((run) => run.id !== focus)]
      : runs;
    const rows = displayedRuns.map((run) => {
      const gross = run.results.reduce((sum, result) => sum + decimalNumber(result.grossPay), 0);
      const net = run.results.reduce((sum, result) => sum + decimalNumber(result.netPay), 0);
      const employerCost = run.results.reduce((sum, result) => sum + decimalNumber(result.employerCost), 0);
      return {
        id: run.id,
        periodCode: run.payrollPeriod.code,
        country: run.payrollPeriod.countryPack.name,
        countryCode: run.payrollPeriod.countryPack.countryCode,
        currency: run.payrollPeriod.countryPack.currency,
        packVersion: run.payrollPeriod.countryPack.version,
        periodStatus: statusLabel(run.payrollPeriod.status),
        status: statusLabel(run.status),
        rawStatus: run.status,
        runNumber: run.runNumber,
        employees: run.results.length,
        gross,
        net,
        employerCost,
        payDate: dayLabel(run.payrollPeriod.payDate),
        approvedById: run.approvedById ?? "—"
      };
    });

    const openRuns = runs.filter((run) => !isClosedPayrollStatus(run.status)).length;
    const employeesInLatestRuns = runs.reduce((sum, run) => sum + run.results.length, 0);

    return {
      activeCountryPacks: packs.length,
      openRuns,
      employeesInLatestRuns,
      focusId: focusedRun?.id ?? null,
      rows
    };
  });
}
