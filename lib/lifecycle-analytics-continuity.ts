import { getLifecycleActionCenterFullContinuityData } from "@/lib/joiner-leaver-action-center-continuity";
import type { RequestContext } from "@/lib/request-context";

export type LifecycleAnalyticsContinuitySummary = {
  total: number;
  overdue: number;
  dueSoon: number;
  critical: number;
  workflow: number;
  hrService: number;
  employeeRelations: number;
  documents: number;
  leave: number;
  timeAttendance: number;
  compensation: number;
  payroll: number;
  benefits: number;
  performance: number;
  learning: number;
  developmentPlans: number;
  succession: number;
  onboarding: number;
  offboarding: number;
};

const EMPTY_SUMMARY: LifecycleAnalyticsContinuitySummary = {
  total: 0,
  overdue: 0,
  dueSoon: 0,
  critical: 0,
  workflow: 0,
  hrService: 0,
  employeeRelations: 0,
  documents: 0,
  leave: 0,
  timeAttendance: 0,
  compensation: 0,
  payroll: 0,
  benefits: 0,
  performance: 0,
  learning: 0,
  developmentPlans: 0,
  succession: 0,
  onboarding: 0,
  offboarding: 0
};

/**
 * Builds an analytics-safe operational continuity projection for the signed actor.
 *
 * The source remains the governed Lifecycle Action Center, so HR Service,
 * Employee Relations, Documents, work-pay, growth, onboarding and offboarding
 * visibility is never recalculated or widened here. Only aggregate counters are
 * returned: titles, descriptions, employee names, case/request numbers, ratings,
 * learning evidence, benefit contribution/coverage details, development outcomes,
 * succession readiness, compensation amounts, payroll results, onboarding task
 * detail, exit-control detail, document metadata and subject identifiers never
 * cross this boundary.
 *
 * Failure is intentionally fail-closed. Analytics may render a degraded state,
 * but it must never retry through a broader tenant query.
 */
export async function getLifecycleAnalyticsContinuity(ctx: RequestContext) {
  try {
    const source = await getLifecycleActionCenterFullContinuityData(ctx);
    const summary: LifecycleAnalyticsContinuitySummary = {
      total: source.summary.total,
      overdue: source.summary.overdue,
      dueSoon: source.summary.dueSoon,
      critical: source.summary.critical,
      workflow: source.summary.workflow,
      hrService: source.summary.hrService,
      employeeRelations: source.summary.employeeRelations,
      documents: source.summary.documents,
      leave: source.summary.leave,
      timeAttendance: source.summary.timeAttendance,
      compensation: source.summary.compensation,
      payroll: source.summary.payroll,
      benefits: source.summary.benefits,
      performance: source.summary.performance,
      learning: source.summary.learning,
      developmentPlans: source.summary.developmentPlans,
      succession: source.summary.succession,
      onboarding: source.summary.onboarding,
      offboarding: source.summary.offboarding
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
