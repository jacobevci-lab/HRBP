import { getEngagementLifecycleActionCenterData as getLifecycleActionCenterContinuityData } from "@/lib/engagement-action-center-continuity";
import { getServerRequestContext } from "@/lib/server-session";

export type DashboardLifecycleAttention = {
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
  workforcePlanning: number;
  privacy: number;
  engagement: number;
};

const emptySummary: DashboardLifecycleAttention = {
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
  policies: 0,
  workforcePlanning: 0,
  privacy: 0,
  engagement: 0
};

export async function getDashboardLifecycleAttentionSafe(): Promise<{
  summary: DashboardLifecycleAttention;
  degraded: boolean;
}> {
  const ctx = await getServerRequestContext();
  if (!ctx) return { summary: emptySummary, degraded: true };

  try {
    const data = await getLifecycleActionCenterContinuityData(ctx);
    return { summary: data.summary, degraded: false };
  } catch (error) {
    console.error("[HRBP] Dashboard lifecycle attention failed; hiding actor-specific action counts", error);
    return { summary: emptySummary, degraded: true };
  }
}
