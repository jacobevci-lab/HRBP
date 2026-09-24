import type { DashboardData } from "@/lib/dashboard-data";
import { getServerRequestContext } from "@/lib/server-session";

function monthLabels() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index - 11, 1));
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  });
}

function fallbackDashboard(): DashboardData {
  const actual = [7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10];
  const plan = [10, 10, 11, 11, 11, 12, 12, 12, 13, 13, 13, 13];
  return {
    tenantName: "HRBP One Demo Workspace",
    totalWorkforce: 10,
    startedThisMonth: 1,
    openPositions: 3,
    criticalOpenPositions: 2,
    upcomingStarters: 2,
    openCases: 2,
    onboardingInProgress: 2,
    yoyChange: 42.9,
    headcountSeries: monthLabels().map((label, index) => ({ label, actual: actual[index] ?? 10, plan: plan[index] ?? 13 })),
    departments: [
      { name: "Engineering", count: 2, pct: 20 },
      { name: "Sales", count: 2, pct: 20 },
      { name: "Security", count: 2, pct: 20 },
      { name: "Operations", count: 2, pct: 20 },
      { name: "Finance", count: 1, pct: 10 },
      { name: "People", count: 1, pct: 10 }
    ],
    lifecycle: { starters: 2, promotions: 1, transfers: 1, leavers: 0 },
    recentEvents: [
      { id: "fallback-1", initials: "CM", name: "Clara Moretti", event: "Hire", org: "Engineering", date: "09 Oct 2026", status: "Scheduled" },
      { id: "fallback-2", initials: "ER", name: "Elena Rossi", event: "Hire", org: "Engineering", date: "28 Sep 2026", status: "Scheduled" },
      { id: "fallback-3", initials: "LC", name: "Lucas Chen", event: "Transfer", org: "Operations", date: "13 Sep 2026", status: "Completed" }
    ]
  };
}

export async function getDashboardDataSafe(): Promise<{ data: DashboardData; degraded: boolean }> {
  const ctx = await getServerRequestContext();
  if (!ctx) {
    return { data: fallbackDashboard(), degraded: true };
  }

  try {
    // Only an authenticated, signed session can select live tenant data. If the
    // live Prisma / pg / Cloudflare path fails, the Command Center remains online
    // using the read-only synthetic snapshot instead of falling through to any
    // other tenant.
    const { getDashboardData } = await import("@/lib/dashboard-data");
    return { data: await getDashboardData(ctx), degraded: false };
  } catch (error) {
    console.error("[HRBP] Dashboard live data failed; using safe staging snapshot", error);
    return { data: fallbackDashboard(), degraded: true };
  }
}
