import { EmploymentStatus, LeaveRequestStatus, PayrollRunStatus, TimeEntryStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
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

export async function getTimeAttendanceLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const now = new Date();
    const today = startOfUtcDay(now);
    const tomorrow = addUtcDays(today, 1);

    const [expected, entries, scheduleAssignments] = await Promise.all([
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
        include: {
          employment: {
            select: {
              id: true,
              person: { select: { employeeNumber: true, givenName: true, familyName: true } },
              position: { select: { title: true, orgUnit: { select: { name: true } } } }
            }
          }
        },
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
      })
    ]);

    const scheduledEmployments = new Set(scheduleAssignments.map((row) => row.employmentId)).size;
    const exceptions = entries.filter((entry) =>
      ![TimeEntryStatus.APPROVED, TimeEntryStatus.LOCKED].includes(entry.status) || !entry.startAt || !entry.endAt
    ).length;
    const overtimeMinutes = entries.reduce((sum, entry) => sum + entry.overtimeMinutes, 0);

    return {
      expected,
      recorded: entries.length,
      exceptions,
      overtimeMinutes,
      scheduleCoverage: expected ? Math.min(100, Math.round((scheduledEmployments / expected) * 1000) / 10) : 0,
      rows: entries.map((entry) => ({
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

export async function getLeaveLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const now = new Date();
    const today = startOfUtcDay(now);
    const horizon = addUtcDays(today, 60);
    const currentYear = today.getUTCFullYear();

    const [requests, balances, awayToday] = await Promise.all([
      db.leaveRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          startsAt: { lte: horizon },
          endsAt: { gte: today },
          ...employmentIdFilter(scope)
        },
        orderBy: [{ status: "asc" }, { startsAt: "asc" }],
        include: {
          leaveType: true,
          employment: {
            select: {
              id: true,
              person: { select: { employeeNumber: true, givenName: true, familyName: true } },
              position: { select: { title: true, orgUnit: { select: { name: true } } } }
            }
          }
        },
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
      })
    ]);

    const pending = requests.filter((request) => request.status === LeaveRequestStatus.PENDING).length;
    const totalRemaining = balances.reduce((sum, balance) => sum + decimalNumber(balance.opening) + decimalNumber(balance.accrued) + decimalNumber(balance.adjustment) - decimalNumber(balance.used), 0);
    const averageRemaining = balances.length ? Math.round((totalRemaining / balances.length) * 10) / 10 : 0;

    return {
      pending,
      awayToday,
      averageRemaining,
      balanceRecords: balances.length,
      rows: requests.map((request) => ({
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

export async function getPayrollLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const [packs, runs] = await Promise.all([
      db.payrollCountryPack.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: { countryCode: "asc" }
      }),
      db.payrollRun.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { startedAt: "desc" },
        include: {
          payrollPeriod: { include: { countryPack: true } },
          results: { select: { grossPay: true, netPay: true, employerCost: true } }
        },
        take: 40
      })
    ]);

    const rows = runs.map((run) => {
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

    const openRuns = runs.filter((run) => ![PayrollRunStatus.PAID, PayrollRunStatus.CANCELLED].includes(run.status)).length;
    const employeesInLatestRuns = rows.reduce((sum, row) => sum + row.employees, 0);

    return {
      activeCountryPacks: packs.length,
      openRuns,
      employeesInLatestRuns,
      rows
    };
  });
}
