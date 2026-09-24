import { monitorAuditIntegrity } from "@/lib/audit-monitoring";
import { runBenefitsMaintenance } from "@/lib/benefits-maintenance";
import { queueDevelopmentPlanReminders } from "@/lib/development-plan-reminders";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runLearningMaintenance } from "@/lib/learning-maintenance";
import { queueLearningReminders } from "@/lib/learning-reminders";
import { runOperationalMaintenance } from "@/lib/operational-maintenance";
import { queueSuccessionReviewReminders } from "@/lib/succession-reminders";
import { queueWorkflowReminders } from "@/lib/workflow-reminders";

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return Response.json({ error: "Valid internal maintenance credentials are required." }, { status: 401 });
  }

  // Audited lifecycle normalizers run serially so their hash-chain writes never
  // race each other for the same tenant ledger head.
  const benefitsLifecycle = await runBenefitsMaintenance();
  const learningLifecycle = await runLearningMaintenance();
  const [workflowReminders, learningReminders, successionReminders, developmentPlanReminders, auditIntegrity] = await Promise.all([
    queueWorkflowReminders(),
    queueLearningReminders(),
    queueSuccessionReviewReminders(),
    queueDevelopmentPlanReminders(),
    monitorAuditIntegrity()
  ]);
  const data = await runOperationalMaintenance();
  return Response.json({ data: { ...data, benefitsLifecycle, learningLifecycle, workflowReminders, learningReminders, successionReminders, developmentPlanReminders, auditIntegrity } });
}
