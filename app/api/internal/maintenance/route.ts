import { internalBearerAuthorized } from "@/lib/internal-auth";
import {
  MAINTENANCE_JOBS, MAINTENANCE_PROTOCOL_VERSION, executeMaintenanceJobs, selectMaintenanceJobs,
  type MaintenanceJobName
} from "@/lib/maintenance-protocol.mjs";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Import only the selected domain. A capability probe never initializes Prisma.
async function runJob(job: MaintenanceJobName): Promise<unknown> {
  switch (job) {
    case "benefits-lifecycle": return (await import("@/lib/benefits-maintenance")).runBenefitsMaintenance();
    case "learning-lifecycle": return (await import("@/lib/learning-maintenance")).runLearningMaintenance();
    case "recruiting-lifecycle": return (await import("@/lib/recruiting-maintenance")).runRecruitingMaintenance();
    case "onboarding-readiness": return (await import("@/lib/onboarding-reminders")).queueOnboardingReadinessReminders();
    case "offboarding-readiness": return (await import("@/lib/offboarding-reminders")).queueOffboardingReadinessReminders();
    case "workflow-reminders": return (await import("@/lib/workflow-reminders")).queueWorkflowReminders();
    case "learning-reminders": return (await import("@/lib/learning-reminders")).queueLearningReminders();
    case "succession-reminders": return (await import("@/lib/succession-reminders")).queueSuccessionReviewReminders();
    case "development-plan-reminders": return (await import("@/lib/development-plan-reminders")).queueDevelopmentPlanReminders();
    case "audit-integrity": return (await import("@/lib/audit-monitoring")).monitorAuditIntegrity();
    case "operational-maintenance": return (await import("@/lib/operational-maintenance")).runOperationalMaintenance();
  }
}

export async function GET(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return json({ error: "Valid internal maintenance credentials are required." }, 401);
  }
  return json({ data: { protocolVersion: MAINTENANCE_PROTOCOL_VERSION, jobs: MAINTENANCE_JOBS } });
}

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return json({ error: "Valid internal maintenance credentials are required." }, 401);
  }
  let jobs: MaintenanceJobName[];
  try {
    jobs = selectMaintenanceJobs(new URL(request.url).searchParams);
  } catch {
    return json({ error: "Exactly one supported maintenance job is required." }, 400);
  }

  const { results, failures, execution } = await executeMaintenanceJobs(jobs, runJob);
  const { operational } = results;
  // Explicit projection preserves the existing public response contract. JSON omits
  // undefined fields for unselected jobs, while failed selected jobs remain null.
  const data = {
    ...(operational && typeof operational === "object" && !Array.isArray(operational) ? operational : {}),
    benefitsLifecycle: results.benefitsLifecycle,
    learningLifecycle: results.learningLifecycle,
    recruitingLifecycle: results.recruitingLifecycle,
    onboardingReadiness: results.onboardingReadiness,
    offboardingReadiness: results.offboardingReadiness,
    workflowReminders: results.workflowReminders,
    learningReminders: results.learningReminders,
    successionReminders: results.successionReminders,
    developmentPlanReminders: results.developmentPlanReminders,
    auditIntegrity: results.auditIntegrity
  };
  console.info("[HRBP] Maintenance execution", execution);
  if (failures.length) {
    // Bounded machine diagnostics only: no exception messages, SQL, tokens or employee data.
    console.error("[HRBP] Maintenance failures", failures);
    return json({
      error: "One or more maintenance jobs failed. Successful jobs were allowed to complete.",
      failures, data, execution
    }, 500);
  }
  return json({ data, execution });
}
