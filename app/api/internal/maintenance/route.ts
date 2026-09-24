import { monitorAuditIntegrity } from "@/lib/audit-monitoring";
import { runBenefitsMaintenance } from "@/lib/benefits-maintenance";
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

  // Normalize time-driven domain state first so reminders, self-service and
  // reporting observe the same governed lifecycle state.
  const [benefitsLifecycle, learningLifecycle] = await Promise.all([
    runBenefitsMaintenance(),
    runLearningMaintenance()
  ]);
  const [workflowReminders, learningReminders, successionReminders, auditIntegrity] = await Promise.all([
    queueWorkflowReminders(),
    queueLearningReminders(),
    queueSuccessionReviewReminders(),
    monitorAuditIntegrity()
  ]);
  const data = await runOperationalMaintenance();
  return Response.json({ data: { ...data, benefitsLifecycle, learningLifecycle, workflowReminders, learningReminders, successionReminders, auditIntegrity } });
}
