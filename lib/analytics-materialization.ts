import { AnalyticsPopulationScope, EmploymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { workforceScopeFingerprint } from "@/lib/analytics-privacy";

type AnalyticsClient = PrismaClient | Prisma.TransactionClient;
const SNAPSHOT_HISTORY_LIMIT = 24;

export type MetricMaterializationInput = {
  tenantId: string;
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  value: Prisma.InputJsonValue;
  dimensions?: Prisma.InputJsonValue;
  population: number;
  scopeEmploymentIds?: string[] | null;
  sourceSuppressed?: boolean;
};

export async function materializeGovernedMetricSnapshot(client: AnalyticsClient, input: MetricMaterializationInput) {
  if (!Number.isInteger(input.population) || input.population < 0) throw new Error("INVALID_POPULATION");
  if (!(input.periodStart instanceof Date) || Number.isNaN(input.periodStart.getTime())) throw new Error("INVALID_PERIOD");
  if (!(input.periodEnd instanceof Date) || Number.isNaN(input.periodEnd.getTime()) || input.periodEnd < input.periodStart) throw new Error("INVALID_PERIOD");

  const metric = await client.metricDefinition.findFirst({
    where: { tenantId: input.tenantId, key: input.metricKey, active: true },
    select: { id: true, minPopulation: true }
  });
  if (!metric) throw new Error("METRIC_NOT_FOUND");

  const requestedScope = input.scopeEmploymentIds === undefined || input.scopeEmploymentIds === null
    ? null
    : [...new Set(input.scopeEmploymentIds)];
  let populationScope: AnalyticsPopulationScope = AnalyticsPopulationScope.TENANT;
  let scopeFingerprint: string | null = null;

  if (requestedScope !== null) {
    const validRows = requestedScope.length ? await client.employment.findMany({
      where: {
        tenantId: input.tenantId,
        id: { in: requestedScope },
        status: { not: EmploymentStatus.TERMINATED }
      },
      select: { id: true }
    }) : [];
    const validIds = validRows.map((row) => row.id);
    if (validIds.length !== requestedScope.length) throw new Error("INVALID_SCOPE_EMPLOYMENT");
    populationScope = AnalyticsPopulationScope.EMPLOYMENT_SET;
    scopeFingerprint = workforceScopeFingerprint(input.tenantId, validIds);
    if (input.population > validIds.length) throw new Error("POPULATION_EXCEEDS_SCOPE");
  }

  const suppressed = Boolean(input.sourceSuppressed) || input.population < metric.minPopulation;
  const snapshot = await client.metricSnapshot.create({
    data: {
      tenantId: input.tenantId,
      metricId: metric.id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      value: input.value,
      dimensions: input.dimensions,
      population: input.population,
      suppressed,
      populationScope,
      scopeFingerprint,
      generatedAt: new Date()
    }
  });

  const stale = await client.metricSnapshot.findMany({
    where: { tenantId: input.tenantId, metricId: metric.id, populationScope, scopeFingerprint },
    orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
    skip: SNAPSHOT_HISTORY_LIMIT,
    take: 500,
    select: { id: true }
  });
  if (stale.length) await client.metricSnapshot.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });

  return snapshot;
}