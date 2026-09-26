import { getLifecycleActionCenterData } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type LifecycleAnalyticsContinuitySummary = {
  total: number;
  overdue: number;
  dueSoon: number;
  critical: number;
  workflow: number;
  hrService: number;
  employeeRelations: number;
};

const EMPTY_SUMMARY: LifecycleAnalyticsContinuitySummary = {
  total: 0,
  overdue: 0,
  dueSoon: 0,
  critical: 0,
  workflow: 0,
  hrService: 0,
  employeeRelations: 0
};

/**
 * Builds an analytics-safe operational continuity projection for the signed actor.
 *
 * The source remains the governed Lifecycle Action Center, so HR Service and
 * Employee Relations visibility is never recalculated or widened here. Only
 * aggregate counters are returned: titles, descriptions, case/request numbers,
 * document metadata and subject identifiers never cross this boundary.
 *
 * Failure is intentionally fail-closed. Analytics may render a degraded state,
 * but it must never retry through a broader tenant query.
 */
export async function getLifecycleAnalyticsContinuity(ctx: RequestContext) {
  try {
    const source = await getLifecycleActionCenterData(ctx);
    const summary: LifecycleAnalyticsContinuitySummary = {
      total: source.summary.total,
      overdue: source.summary.overdue,
      dueSoon: source.summary.dueSoon,
      critical: source.summary.critical,
      workflow: source.summary.workflow,
      hrService: source.summary.hrService,
      employeeRelations: source.summary.employeeRelations
    };

    return {
      summary,
      generatedAt: source.generatedAt,
      degraded: false as const,
      privacy: {
        actorScoped: true as const,
        aggregateOnly: true as const,
        source: "lifecycle-action-center" as const
      }
    };
  } catch {
    return {
      summary: { ...EMPTY_SUMMARY },
      generatedAt: new Date().toISOString(),
      degraded: true as const,
      privacy: {
        actorScoped: true as const,
        aggregateOnly: true as const,
        source: "lifecycle-action-center" as const
      }
    };
  }
}
