import { monitorAuditIntegrity } from "@/lib/audit-monitoring";
import { runBenefitsMaintenance } from "@/lib/benefits-maintenance";
import { queueDevelopmentPlanReminders } from "@/lib/development-plan-reminders";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runLearningMaintenance } from "@/lib/learning-maintenance";
import { queueLearningReminders } from "@/lib/learning-reminders";
import { queueOffboardingReadinessReminders } from "@/lib/offboarding-reminders";
import { queueOnboardingReadinessReminders } from "@/lib/onboarding-reminders";
import { runOperationalMaintenance } from "@/lib/operational-maintenance";
import { runRecruitingMaintenance } from "@/lib/recruiting-maintenance";
import { queueSuccessionReviewReminders } from "@/lib/succession-reminders";
import { queueWorkflowReminders } from "@/lib/workflow-reminders";

type MaintenanceFailure = { job: string; type: string; code?: string };

function describeFailure(job: string, error: unknown): MaintenanceFailure {
  const value = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : null;
  return {
    job,
    type: typeof value?.name === "string" && value.name ? value.name : "Error",
    ...(typeof value?.code === "string" && value.code ? { code: value.code } : {})
  };
}

async function capture<T>(job: string, run: () => Promise<T>, failures: MaintenanceFailure[]): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    const failure = describeFailure(job, error);
    failures.push(failure);
    console.error(`[HRBP] Maintenance job failed: ${job}`, error);
    return null;
  }
}

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return Response.json({ error: "Valid internal maintenance credentials are required." }, { status: 401 });
  }

  const failures: MaintenanceFailure[] = [];

  // Audited lifecycle normalizers and readiness escalation remain serialized so
  // their hash-chain writes never race each other for the same tenant ledger head.
  // Each job is isolated: one domain failure must not suppress all later maintenance.
  const benefitsLifecycle = await capture("benefits-lifecycle", runBenefitsMaintenance, failures);
  const learningLifecycle = await capture("learning-lifecycle", runLearningMaintenance, failures);
  const recruitingLifecycle = await capture("recruiting-lifecycle", runRecruitingMaintenance, failures);
  const onboardingReadiness = await capture("onboarding-readiness", queueOnboardingReadinessReminders, failures);
  const offboardingReadiness = await capture("offboarding-readiness", queueOffboardingReadinessReminders, failures);

  const [workflowReminders, learningReminders, successionReminders, developmentPlanReminders, auditIntegrity] = await Promise.all([
    capture("workflow-reminders", queueWorkflowReminders, failures),
    capture("learning-reminders", queueLearningReminders, failures),
    capture("succession-reminders", queueSuccessionReviewReminders, failures),
    capture("development-plan-reminders", queueDevelopmentPlanReminders, failures),
    capture("audit-integrity", monitorAuditIntegrity, failures)
  ]);

  const operational = await capture("operational-maintenance", runOperationalMaintenance, failures);
  const data = {
    ...(operational ?? {}),
    benefitsLifecycle,
    learningLifecycle,
    recruitingLifecycle,
    onboardingReadiness,
    offboardingReadiness,
    workflowReminders,
    learningReminders,
    successionReminders,
    developmentPlanReminders,
    auditIntegrity
  };

  if (failures.length) {
    return Response.json({
      error: "One or more maintenance jobs failed. Successful jobs were allowed to complete.",
      failures,
      data
    }, { status: 500 });
  }

  return Response.json({ data });
}
