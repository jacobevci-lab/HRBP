import {
  EmploymentStatus,
  GoalStatus,
  LeaveRequestStatus,
  Prisma,
  PrismaClient,
  TimeEntryStatus
} from "@prisma/client";
import { materializeGovernedMetricSnapshot } from "@/lib/analytics-materialization";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type AnalyticsClient = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 86_400_000;

export const BUILT_IN_METRICS = [
  {
    key: "WORKFORCE_HEADCOUNT",
    name: "Current Headcount",
    description: "Current non-terminated employments inside the authorized workforce population.",
    category: "Workforce",
    unit: "COUNT",
    aggregation: "COUNT",
    minPopulation: 7
  },
  {
    key: "LEAVE_INCIDENCE_30D",
    name: "30-day Leave Incidence",
    description: "Share of the authorized workforce with approved or taken leave overlapping the last 30 days.",
    category: "Absence",
    unit: "PERCENT",
    aggregation: "RATE",
    minPopulation: 7
  },
  {
    key: "TIME_APPROVAL_RATE_30D",
    name: "30-day Time Approval Rate",
    description: "Approved or locked time entries as a share of submitted, approved, rejected or locked entries in the last 30 days.",
    category: "Attendance",
    unit: "PERCENT",
    aggregation: "RATE",
    minPopulation: 7
  },
  {
    key: "GOAL_COVERAGE_YTD",
    name: "YTD Goal Coverage",
    description: "Share of the authorized workforce with at least one non-cancelled goal intersecting the current year.",
    category: "Performance",
    unit: "PERCENT",
    aggregation: "COVERAGE",
    minPopulation: 7
  },
  {
    key: "PERFORMANCE_REVIEW_COVERAGE",
    name: "Latest Review Cycle Coverage",
    description: "Share of the authorized workforce represented in the latest started performance review cycle.",
    category: "Performance",
    unit: "PERCENT",
    aggregation: "COVERAGE",
    minPopulation: 7
  }
] as const;

function roundPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function startOfUtcYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export async function resolveAuthorizedAnalyticsPopulation(client: AnalyticsClient, ctx: RequestContext) {
  const scope = await resolveEmploymentScope(client, ctx);
  const where = scope === null
    ? { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }
    : { tenantId: ctx.tenantId, id: { in: scope }, status: { not: EmploymentStatus.TERMINATED } };
  const rows = await client.employment.findMany({ where, select: { id: true } });
  return {
    employmentIds: rows.map((row) => row.id),
    relationshipScoped: scope !== null
  };
}

async function ensureBuiltInDefinitions(client: AnalyticsClient, tenantId: string) {
  for (const definition of BUILT_IN_METRICS) {
    await client.metricDefinition.upsert({
      where: { tenantId_key: { tenantId, key: definition.key } },
      update: {
        name: definition.name,
        description: definition.description,
        category: definition.category,
        unit: definition.unit,
        aggregation: definition.aggregation,
        minPopulation: definition.minPopulation,
        sensitiveDimensions: ["employment"],
        active: true
      },
      create: {
        tenantId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        unit: definition.unit,
        aggregation: definition.aggregation,
        minPopulation: definition.minPopulation,
        sensitiveDimensions: ["employment"],
        active: true
      }
    });
  }
}

export async function materializeBuiltInAnalyticsForContext(client: AnalyticsClient, ctx: RequestContext, at = new Date()) {
  await ensureBuiltInDefinitions(client, ctx.tenantId);
  const { employmentIds, relationshipScoped } = await resolveAuthorizedAnalyticsPopulation(client, ctx);
  const scopeEmploymentIds = relationshipScoped ? employmentIds : null;
  const last30Days = new Date(at.getTime() - 30 * DAY_MS);
  const yearStart = startOfUtcYear(at);

  const [leaveRows, timeRows, goalRows, latestCycle] = await Promise.all([
    employmentIds.length ? client.leaveRequest.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: { in: employmentIds },
        status: { in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.TAKEN] },
        startsAt: { lte: at },
        endsAt: { gte: last30Days }
      },
      select: { employmentId: true }
    }) : [],
    employmentIds.length ? client.timeEntry.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: { in: employmentIds },
        workDate: { gte: last30Days, lte: at },
        status: { in: [TimeEntryStatus.SUBMITTED, TimeEntryStatus.APPROVED, TimeEntryStatus.REJECTED, TimeEntryStatus.LOCKED] }
      },
      select: { employmentId: true, status: true }
    }) : [],
    employmentIds.length ? client.goal.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: { in: employmentIds },
        status: { not: GoalStatus.CANCELLED },
        startsAt: { lte: at },
        dueAt: { gte: yearStart }
      },
      select: { employmentId: true }
    }) : [],
    client.reviewCycle.findFirst({
      where: { tenantId: ctx.tenantId, startsAt: { lte: at } },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, status: true, startsAt: true, endsAt: true }
    })
  ]);

  const reviewRows = latestCycle && employmentIds.length ? await client.performanceReview.findMany({
    where: { tenantId: ctx.tenantId, cycleId: latestCycle.id, employmentId: { in: employmentIds } },
    select: { employmentId: true }
  }) : [];

  const workforcePopulation = employmentIds.length;
  const leaveEmployees = new Set(leaveRows.map((row) => row.employmentId));
  const timeEmployees = new Set(timeRows.map((row) => row.employmentId));
  const approvedTimeEntries = timeRows.filter((row) => row.status === TimeEntryStatus.APPROVED || row.status === TimeEntryStatus.LOCKED).length;
  const goalEmployees = new Set(goalRows.map((row) => row.employmentId));
  const reviewEmployees = new Set(reviewRows.map((row) => row.employmentId));

  const inputs = [
    {
      metricKey: "WORKFORCE_HEADCOUNT",
      periodStart: at,
      periodEnd: at,
      value: workforcePopulation,
      population: workforcePopulation,
      dimensions: { source: "Employment", statusBoundary: "non-terminated" }
    },
    {
      metricKey: "LEAVE_INCIDENCE_30D",
      periodStart: last30Days,
      periodEnd: at,
      value: roundPercent(leaveEmployees.size, workforcePopulation),
      population: workforcePopulation,
      dimensions: { numerator: leaveEmployees.size, denominator: workforcePopulation, statuses: ["APPROVED", "TAKEN"] }
    },
    {
      metricKey: "TIME_APPROVAL_RATE_30D",
      periodStart: last30Days,
      periodEnd: at,
      value: roundPercent(approvedTimeEntries, timeRows.length),
      population: timeEmployees.size,
      dimensions: { approvedEntries: approvedTimeEntries, eligibleEntries: timeRows.length }
    },
    {
      metricKey: "GOAL_COVERAGE_YTD",
      periodStart: yearStart,
      periodEnd: at,
      value: roundPercent(goalEmployees.size, workforcePopulation),
      population: workforcePopulation,
      dimensions: { numerator: goalEmployees.size, denominator: workforcePopulation }
    },
    {
      metricKey: "PERFORMANCE_REVIEW_COVERAGE",
      periodStart: latestCycle?.startsAt ?? yearStart,
      periodEnd: latestCycle?.endsAt ?? at,
      value: roundPercent(reviewEmployees.size, workforcePopulation),
      population: workforcePopulation,
      dimensions: latestCycle
        ? { numerator: reviewEmployees.size, denominator: workforcePopulation, cycle: latestCycle.name, cycleStatus: latestCycle.status }
        : { numerator: 0, denominator: workforcePopulation, cycle: null }
    }
  ] satisfies Array<{
    metricKey: string;
    periodStart: Date;
    periodEnd: Date;
    value: Prisma.InputJsonValue;
    population: number;
    dimensions: Prisma.InputJsonValue;
  }>;

  const snapshots = [];
  for (const input of inputs) {
    snapshots.push(await materializeGovernedMetricSnapshot(client, {
      tenantId: ctx.tenantId,
      scopeEmploymentIds,
      ...input
    }));
  }

  return {
    metricKeys: inputs.map((input) => input.metricKey),
    materialized: snapshots.length,
    authorizedPopulation: workforcePopulation,
    relationshipScoped,
    generatedAt: at
  };
}
