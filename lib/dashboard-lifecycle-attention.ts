import { getLifecycleActionCenterData } from "@/lib/lifecycle-action-center";
import { getServerRequestContext } from "@/lib/server-session";

export type DashboardLifecycleAttention = {
  total: number;
  overdue: number;
  dueSoon: number;
  critical: number;
  workflow: number;
  hrService: number;
  employeeRelations: number;
};

const emptySummary: DashboardLifecycleAttention = {
  total: 0,
  overdue: 0,
  dueSoon: 0,
  critical: 0,
  workflow: 0,
  hrService: 0,
  employeeRelations: 0
};

export async function getDashboardLifecycleAttentionSafe(): Promise<{
  summary: DashboardLifecycleAttention;
  degraded: boolean;
}> {
  const ctx = await getServerRequestContext();
  if (!ctx) return { summary: emptySummary, degraded: true };

  try {
    const data = await getLifecycleActionCenterData(ctx);
    return { summary: data.summary, degraded: false };
  } catch (error) {
    console.error("[HRBP] Dashboard lifecycle attention failed; hiding actor-specific action counts", error);
    return { summary: emptySummary, degraded: true };
  }
}
