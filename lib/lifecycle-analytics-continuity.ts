import { getPolicyLifecycleActionCenterData as getLifecycleActionCenterContinuityData } from "@/lib/policy-action-center-continuity";
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
  recruiting: number;
  policies: number;
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
  offboarding: 0,
  recruiting: 0,
  policies: 0
};

/**
 * Builds an analytics-safe operational continuity projection for the signed actor.
 * The source remains the governed Lifecycle Action Center. Only aggregate counters
 * cross this boundary; titles, employee names, ratings, learning evidence,
 * onboarding task detail, offboarding clearance detail, recruiting candidate detail,
 * policy content/assignment detail, pay data and document metadata remain in their owning domains.
 */
export async function getLifecycleAnalyticsContinuity(ctx: RequestContext) {
  try {
    const source = await getLifecycleActionCenterContinuityData(ctx);
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
      offboarding: source.summary.offboarding,
      recruiting: source.summary.recruiting,
      policies: source.summary.policies
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
