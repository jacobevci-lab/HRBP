import { monitorAuditIntegrity } from "@/lib/audit-monitoring";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runOperationalMaintenance } from "@/lib/operational-maintenance";
import { queueSuccessionReviewReminders } from "@/lib/succession-reminders";
import { queueWorkflowReminders } from "@/lib/workflow-reminders";

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return Response.json({ error: "Valid internal maintenance credentials are required." }, { status: 401 });
  }
  const [workflowReminders, successionReminders, auditIntegrity] = await Promise.all([
    queueWorkflowReminders(),
    queueSuccessionReviewReminders(),
    monitorAuditIntegrity()
  ]);
  const data = await runOperationalMaintenance();
  return Response.json({ data: { ...data, workflowReminders, successionReminders, auditIntegrity } });
}
