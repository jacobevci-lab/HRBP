export type MaintenanceJobName =
  | "benefits-lifecycle" | "learning-lifecycle" | "recruiting-lifecycle"
  | "onboarding-readiness" | "offboarding-readiness" | "workflow-reminders"
  | "learning-reminders" | "succession-reminders" | "development-plan-reminders"
  | "audit-integrity" | "operational-maintenance";
export const MAINTENANCE_PROTOCOL_VERSION: 1;
export const MAINTENANCE_JOBS: readonly MaintenanceJobName[];
export type MaintenanceFailure = { job: MaintenanceJobName; type: string; code?: string };
export type MaintenanceExecution = {
  protocolVersion: 1;
  mode: "single" | "all";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  jobs: Array<{ job: MaintenanceJobName; status: "success" | "failed"; durationMs: number }>;
};
export function selectMaintenanceJobs(searchParams: URLSearchParams): MaintenanceJobName[];
export function executeMaintenanceJobs(
  jobNames: readonly MaintenanceJobName[],
  run: (job: MaintenanceJobName) => Promise<unknown>,
  now?: () => number
): Promise<{ results: Record<string, unknown>; failures: MaintenanceFailure[]; execution: MaintenanceExecution }>;
