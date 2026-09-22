import { createHash } from "node:crypto";
import { AnalyticsPopulationScope, EmploymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type AnalyticsClient = PrismaClient | Prisma.TransactionClient;

export type AnalyticsPrivacyState = "VISIBLE" | "MIN_POPULATION" | "SOURCE_SUPPRESSED" | "SCOPED_RECOMPUTE_REQUIRED" | "NO_SNAPSHOT";

export function workforceScopeFingerprint(tenantId: string, employmentIds: string[]) {
  const canonical = [...new Set(employmentIds)].sort();
  return createHash("sha256").update(`hrbp-analytics-scope-v1|${tenantId}|${canonical.join("|")}`).digest("hex");
}

function safeSnapshot<T extends {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  value: Prisma.JsonValue;
  dimensions: Prisma.JsonValue | null;
  population: number;
  suppressed: boolean;
  generatedAt: Date;
}>(snapshot: T, minPopulation: number) {
  const suppressed = snapshot.suppressed || snapshot.population < minPopulation;
  if (suppressed) {
    return {
      id: snapshot.id,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      value: null,
      dimensions: null,
      population: null,
      suppressed: true,
      suppressionReason: snapshot.population < minPopulation ? "MIN_POPULATION" as const : "SOURCE_SUPPRESSED" as const,
      generatedAt: snapshot.generatedAt
    };
  }
  return {
    id: snapshot.id,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    value: snapshot.value,
    dimensions: snapshot.dimensions,
    population: snapshot.population,
    suppressed: false,
    suppressionReason: null,
    generatedAt: snapshot.generatedAt
  };
}

export async function getGovernedAnalyticsMetrics(client: AnalyticsClient, ctx: RequestContext, metricKey?: string | null) {
  const scope = await resolveEmploymentScope(client, ctx);
  const authorizedRows = scope === null
    ? await client.employment.findMany({
        where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
        select: { id: true }
      })
    : scope.length
      ? await client.employment.findMany({
          where: { tenantId: ctx.tenantId, id: { in: scope }, status: { not: EmploymentStatus.TERMINATED } },
          select: { id: true }
        })
      : [];
  const authorizedIds = authorizedRows.map((row) => row.id);
  const relationshipScoped = scope !== null;
  const fingerprint = relationshipScoped ? workforceScopeFingerprint(ctx.tenantId, authorizedIds) : null;
  const populationScope = relationshipScoped ? AnalyticsPopulationScope.EMPLOYMENT_SET : AnalyticsPopulationScope.TENANT;

  const definitions = await client.metricDefinition.findMany({
    where: { tenantId: ctx.tenantId, active: true, ...(metricKey ? { key: metricKey } : {}) },
    orderBy: { name: "asc" },
    take: 100,
    include: {
      snapshots: {
        where: relationshipScoped
          ? { populationScope, scopeFingerprint: fingerprint }
          : { populationScope, scopeFingerprint: null },
        orderBy: { periodEnd: "desc" },
        take: 12
      }
    }
  });

  const data = definitions.map((definition) => {
    const snapshots = definition.snapshots.map((snapshot) => safeSnapshot(snapshot, definition.minPopulation));
    const hasVisible = snapshots.some((snapshot) => !snapshot.suppressed);
    const hasSourceSuppressed = snapshots.some((snapshot) => snapshot.suppressionReason === "SOURCE_SUPPRESSED");
    const privacyState: AnalyticsPrivacyState = hasVisible
      ? "VISIBLE"
      : authorizedIds.length < definition.minPopulation
        ? "MIN_POPULATION"
        : relationshipScoped && snapshots.length === 0
          ? "SCOPED_RECOMPUTE_REQUIRED"
          : hasSourceSuppressed
            ? "SOURCE_SUPPRESSED"
            : snapshots.length
              ? "MIN_POPULATION"
              : "NO_SNAPSHOT";

    return {
      id: definition.id,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      unit: definition.unit,
      aggregation: definition.aggregation,
      minPopulation: definition.minPopulation,
      sensitiveDimensions: definition.sensitiveDimensions,
      snapshots,
      privacy: {
        state: privacyState,
        authorizedPopulation: authorizedIds.length,
        minPopulation: definition.minPopulation,
        relationshipScoped,
        populationScope
      }
    };
  });

  return {
    data,
    privacy: {
      authorizationMode: relationshipScoped ? "RELATIONSHIP_SCOPED" as const : "TENANT_WIDE" as const,
      authorizedPopulation: authorizedIds.length,
      populationScope,
      scopeBoundSnapshots: true,
      minPopulationEnforcedAtRead: true
    }
  };
}
