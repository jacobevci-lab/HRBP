export type ReadinessFilter = "all" | "blocked" | "overdue" | "start-risk" | "ready" | "waiting" | "review";
export const READINESS_FILTERS: readonly ReadinessFilter[];
export type ReadinessTask = { id: string; planId: string; title: string; ownerType: string; status: string; dueDate: string | null; sensitive: boolean };
export type ReadinessPlan = { id: string; person: string; employeeNumber: string; planStatus: string; employmentStatus: string | null; targetStartDate: string; employmentStartDate: string | null; totalTasks: number };
export type ReadinessSnapshot = { plans: ReadinessPlan[]; tasks: ReadinessTask[]; generatedAt: string; startRiskHours: number };
export type ReadinessIssue = "incomplete" | "no-tasks" | "unlinked" | "dates" | "unknown-state" | "state-mismatch" | "unscheduled";
export type ReadinessPlanView = ReadinessPlan & {
  tasks: ReadinessTask[]; completed: number; waived: number; blocked: number; overdue: number;
  unscheduled: number; open: number; incomplete: boolean; issues: ReadinessIssue[];
  needsReview: boolean; ready: boolean; waiting: boolean; startRisk: boolean; clearancePercent: number | null;
};
export function startRiskHours(value: number): number;
export function buildOnboardingReadiness(snapshot: ReadinessSnapshot, now?: number): {
  plans: ReadinessPlanView[]; startRiskHours: number;
  summary: { plans: number; tasks: number; blocked: number; overdue: number; startRisk: number; ready: number; waiting: number; review: number };
};
export function filterOnboardingReadiness(plans: ReadinessPlanView[], options?: { filter?: ReadinessFilter; owner?: string; query?: string; locale?: string }): ReadinessPlanView[];
