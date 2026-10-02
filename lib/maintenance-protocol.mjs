/** Shared, dependency-free contract for the Worker and its external scheduler. */
export const MAINTENANCE_PROTOCOL_VERSION = 1;
export const MAINTENANCE_JOBS = Object.freeze([
  "benefits-lifecycle", "learning-lifecycle", "recruiting-lifecycle",
  "onboarding-readiness", "offboarding-readiness", "workflow-reminders",
  "learning-reminders", "succession-reminders", "development-plan-reminders",
  "audit-integrity", "operational-maintenance"
]);
const resultKeys = Object.freeze({
  "benefits-lifecycle": "benefitsLifecycle",
  "learning-lifecycle": "learningLifecycle",
  "recruiting-lifecycle": "recruitingLifecycle",
  "onboarding-readiness": "onboardingReadiness",
  "offboarding-readiness": "offboardingReadiness",
  "workflow-reminders": "workflowReminders",
  "learning-reminders": "learningReminders",
  "succession-reminders": "successionReminders",
  "development-plan-reminders": "developmentPlanReminders",
  "audit-integrity": "auditIntegrity",
  "operational-maintenance": "operational"
});

/** Missing selector preserves the legacy all-jobs request. Empty/duplicate selectors do not. */
export function selectMaintenanceJobs(searchParams) {
  const values = searchParams.getAll("job");
  if (!values.length) return [...MAINTENANCE_JOBS];
  if (values.length !== 1 || !MAINTENANCE_JOBS.includes(values[0])) {
    throw new RangeError("Exactly one supported maintenance job is required.");
  }
  return [values[0]];
}

function diagnostic(value, fallback) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : fallback;
}

/** Serial execution also protects audited jobs when the compatibility endpoint is used. */
export async function executeMaintenanceJobs(jobNames, run, now = Date.now) {
  if (!Array.isArray(jobNames) || !jobNames.length || new Set(jobNames).size !== jobNames.length ||
      jobNames.some((job) => !MAINTENANCE_JOBS.includes(job))) {
    throw new RangeError("Unsupported or duplicate maintenance job.");
  }
  const startedAt = now();
  const results = {};
  const failures = [];
  const jobs = [];
  for (const job of jobNames) {
    const jobStartedAt = now();
    let status = "success";
    try {
      results[resultKeys[job]] = await run(job);
    } catch (error) {
      status = "failed";
      results[resultKeys[job]] = null;
      const type = diagnostic(error?.name, "Error");
      const code = diagnostic(error?.code, undefined);
      failures.push({ job, type, ...(code ? { code } : {}) });
    }
    jobs.push({ job, status, durationMs: Math.max(0, now() - jobStartedAt) });
  }
  const completedAt = now();
  return {
    results,
    failures,
    execution: {
      protocolVersion: MAINTENANCE_PROTOCOL_VERSION,
      mode: jobNames.length === 1 ? "single" : "all",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: Math.max(0, completedAt - startedAt),
      jobs
    }
  };
}
