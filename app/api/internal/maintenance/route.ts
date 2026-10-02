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
    case "benefits-lifecycle": {
      const { runBenefitsMaintenance } = await import("@/lib/benefits-maintenance");
      return await runBenefitsMaintenance();
    }
    case "learning-lifecycle": {
      const { runLearningMaintenance } = await import("@/lib/learning-maintenance");
      return await runLearningMaintenance();
    }
    case "recruiting-lifecycle": {
      const { runRecruitingMaintenance } = await import("@/lib/recruiting-maintenance");
      return await runRecruitingMaintenance();
    }
    case "onboarding-readiness": {
      const { queueOnboardingReadinessReminders } = await import("@/lib/onboarding-reminders");
      return await queueOnboardingReadinessReminders();
    }
    case "offboarding-readiness": {
      const { queueOffboardingReadinessReminders } = await import("@/lib/offboarding-reminders");
      return await queueOffboardingReadinessReminders();
    }
    case "workflow-reminders": {
      const { queueWorkflowReminders } = await import("@/lib/workflow-reminders");
      return await queueWorkflowReminders();
    }
    case "learning-reminders": {
      const { queueLearningReminders } = await import("@/lib/learning-reminders");
      return await queueLearningReminders();
    }
    case "succession-reminders": {
      const { queueSuccessionReviewReminders } = await import("@/lib/succession-reminders");
      return await queueSuccessionReviewReminders();
    }
    case "development-plan-reminders": {
      const { queueDevelopmentPlanReminders } = await import("@/lib/development-plan-reminders");
      return await queueDevelopmentPlanReminders();
    }
    case "audit-integrity": {
      const { monitorAuditIntegrity } = await import("@/lib/audit-monitoring");
      return await monitorAuditIntegrity();
    }
    case "operational-maintenance": {
      const { runOperationalMaintenance } = await import("@/lib/operational-maintenance");
      return await runOperationalMaintenance();
    }
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
