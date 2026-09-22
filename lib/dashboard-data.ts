import { CaseStatus, EmploymentStatus, LifecycleEventType, PositionStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type DashboardEvent = {
  id: string;
  initials: string;
  name: string;
  event: string;
  org: string;
  date: string;
  status: "Completed" | "Scheduled";
};

export type DashboardData = {
  tenantName: string;
  totalWorkforce: number;
  startedThisMonth: number;
  openPositions: number;
  criticalOpenPositions: number;
  upcomingStarters: number;
  openCases: number;
  onboardingInProgress: number;
  yoyChange: number;
  headcountSeries: Array<{ label: string; actual: number; plan: number }>;
  departments: Array<{ name: string; count: number; pct: number }>;
  lifecycle: {
    starters: number;
    promotions: number;
    transfers: number;
    leavers: number;
  };
  recentEvents: DashboardEvent[];
};

const eventLabels: Record<LifecycleEventType, string> = {
  HIRED: "Hire",
  TRANSFERRED: "Transfer",
  PROMOTED: "Promotion",
  MANAGER_CHANGED: "Manager change",
  COMPENSATION_CHANGED: "Compensation",
  LEAVE_STARTED: "Leave started",
  LEAVE_ENDED: "Leave ended",
  TERMINATED: "Termination",
  REHIRED: "Rehire"
};

function emptyDashboard(tenantName = "Workspace"): DashboardData {
  return {
    tenantName,
    totalWorkforce: 0,
    startedThisMonth: 0,
    openPositions: 0,
    criticalOpenPositions: 0,
    upcomingStarters: 0,
    openCases: 0,
    onboardingInProgress: 0,
    yoyChange: 0,
    headcountSeries: [],
    departments: [],
    lifecycle: { starters: 0, promotions: 0, transfers: 0, leavers: 0 },
    recentEvents: []
  };
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function displayDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

function initials(givenName: string, familyName: string) {
  return `${givenName[0] ?? ""}${familyName[0] ?? ""}`.toUpperCase();
}

export async function getDashboardData(ctx: RequestContext): Promise<DashboardData> {
  return withDb(async (db) => {
    const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { id: true, name: true } });
    if (!tenant) return emptyDashboard();

    const tenantId = tenant.id;
    const scope = await resolveEmploymentScope(db, ctx);
    const employmentScope = employmentPrimaryKeyFilter(scope);
    const employments = await db.employment.findMany({
      where: { tenantId, ...employmentScope },
      select: {
        id: true,
        personId: true,
        status: true,
        startDate: true,
        endDate: true,
        person: { select: { givenName: true, familyName: true } },
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      }
    });

    const personIds = [...new Set(employments.map((employment) => employment.personId))];
    const now = new Date();
    const monthStart = startOfMonth(now);
    const nextMonth = addMonths(monthStart, 1);
    const next30Days = addDays(now, 30);

    const [positions, openCases, onboardingInProgress, lifecycleEvents] = await Promise.all([
      can(ctx, "positions:read")
        ? db.position.findMany({
            where: { tenantId, validTo: null },
            select: { status: true, critical: true }
          })
        : Promise.resolve([]),
      can(ctx, "cases:read")
        ? db.employeeCase.count({
            where: {
              tenantId,
              status: { in: [CaseStatus.OPEN, CaseStatus.INVESTIGATING, CaseStatus.ACTION_REQUIRED] },
              OR: [
                { ownerUserId: ctx.actorId },
                { assignments: { some: { user: { is: { id: ctx.actorId, tenantId, active: true } } } } }
              ]
            }
          })
        : Promise.resolve(0),
      can(ctx, "onboarding:read")
        ? db.onboardingPlan.count({
            where: {
              tenantId,
              status: { in: ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"] },
              ...(scope === null ? {} : { employmentId: { in: scope } })
            }
          })
        : Promise.resolve(0),
      personIds.length
        ? db.employeeLifecycleEvent.findMany({
            where: { tenantId, personId: { in: personIds } },
            orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
            take: 12,
            select: {
              id: true,
              personId: true,
              type: true,
              effectiveAt: true,
              summary: true,
              person: { select: { givenName: true, familyName: true } }
            }
          })
        : Promise.resolve([])
    ]);

    const activeEmployments = employments.filter((employment) => employment.status === EmploymentStatus.ACTIVE);
    const preboarding = employments.filter(
      (employment) =>
        employment.status === EmploymentStatus.PREBOARDING &&
        employment.startDate >= now &&
        employment.startDate <= next30Days
    );
    const openPositions = positions.filter((position) => position.status === PositionStatus.OPEN);
    const criticalOpenPositions = openPositions.filter((position) => position.critical).length;

    const departmentCounts = new Map<string, number>();
    for (const employment of activeEmployments) {
      const name = employment.position?.orgUnit.name ?? "Unassigned";
      departmentCounts.set(name, (departmentCounts.get(name) ?? 0) + 1);
    }
    const activeCount = activeEmployments.length;
    const departments = [...departmentCounts.entries()]
      .map(([name, count]) => ({ name, count, pct: activeCount ? Math.round((count / activeCount) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    const headcountSeries = Array.from({ length: 12 }, (_, index) => {
      const start = addMonths(monthStart, index - 11);
      const end = addMonths(start, 1);
      const actual = employments.filter(
        (employment) => employment.startDate < end && (!employment.endDate || employment.endDate >= start)
      ).length;
      return {
        label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(start),
        actual,
        plan: actual + openPositions.length
      };
    });

    const currentHeadcount = headcountSeries.at(-1)?.actual ?? activeCount;
    const previousYearHeadcount = headcountSeries.at(0)?.actual ?? currentHeadcount;
    const yoyChange = previousYearHeadcount
      ? Math.round(((currentHeadcount - previousYearHeadcount) / previousYearHeadcount) * 1000) / 10
      : 0;

    const monthLifecycle = lifecycleEvents.filter(
      (event) => event.effectiveAt >= monthStart && event.effectiveAt < nextMonth
    );
    const countType = (type: LifecycleEventType) => monthLifecycle.filter((event) => event.type === type).length;

    const employmentByPerson = new Map(employments.map((employment) => [employment.personId, employment]));
    const recentEvents: DashboardEvent[] = lifecycleEvents.slice(0, 6).map((event) => {
      const employment = employmentByPerson.get(event.personId);
      return {
        id: event.id,
        initials: initials(event.person.givenName, event.person.familyName),
        name: `${event.person.givenName} ${event.person.familyName}`,
        event: eventLabels[event.type],
        org: employment?.position?.orgUnit.name ?? "Unassigned",
        date: displayDate(event.effectiveAt),
        status: event.effectiveAt > now ? "Scheduled" : "Completed"
      };
    });

    const startedThisMonth = employments.filter(
      (employment) => employment.startDate >= monthStart && employment.startDate < nextMonth
    ).length;

    return {
      tenantName: tenant.name,
      totalWorkforce: activeCount,
      startedThisMonth,
      openPositions: openPositions.length,
      criticalOpenPositions,
      upcomingStarters: preboarding.length,
      openCases,
      onboardingInProgress,
      yoyChange,
      headcountSeries,
      departments,
      lifecycle: {
        starters: countType(LifecycleEventType.HIRED) + countType(LifecycleEventType.REHIRED),
        promotions: countType(LifecycleEventType.PROMOTED),
        transfers: countType(LifecycleEventType.TRANSFERRED),
        leavers: countType(LifecycleEventType.TERMINATED)
      },
      recentEvents
    };
  });
}
