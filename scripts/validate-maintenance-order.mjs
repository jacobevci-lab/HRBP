import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as tick } from "node:timers/promises";
import { MAINTENANCE_JOBS, executeMaintenanceJobs } from "../lib/maintenance-protocol.mjs";

/** Exercise the shared scheduler contract rather than requiring a legacy Promise.all layout. */
export async function validateMaintenanceOrder() {
  const route = await readFile("app/api/internal/maintenance/route.ts", "utf8");
  assert.match(route, /executeMaintenanceJobs\(jobs, runJob\)/, "the HTTP route must use the tested orchestrator");
  assert.match(route, /case "onboarding-readiness":[\s\S]*return await queueOnboardingReadinessReminders\(\)/);
  assert.match(route, /case "offboarding-readiness":[\s\S]*return await queueOffboardingReadinessReminders\(\)/);
  const index = (job) => {
    const value = MAINTENANCE_JOBS.indexOf(job);
    assert.ok(value >= 0, `${job} must remain in the execution manifest`);
    return value;
  };
  assert.ok(index("learning-lifecycle") < index("onboarding-readiness"));
  assert.ok(index("onboarding-readiness") < index("offboarding-readiness"));
  for (const reminder of ["workflow-reminders", "learning-reminders", "succession-reminders", "development-plan-reminders"]) {
    assert.ok(index("offboarding-readiness") < index(reminder), "audited readiness must precede reminders");
  }
  let active = 0;
  const calls = [];
  const report = await executeMaintenanceJobs(MAINTENANCE_JOBS, async (job) => {
    active += 1;
    assert.equal(active, 1, "audited maintenance jobs must never overlap within an execution");
    calls.push(job);
    await tick();
    active -= 1;
    return { checked: true };
  });
  assert.deepEqual(report.failures, [], "serial execution must complete without contract errors");
  assert.deepEqual(calls, MAINTENANCE_JOBS);
  assert.equal(active, 0);
  assert.equal(report.execution.mode, "all");
}
