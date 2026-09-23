import { DataClassification, ExitTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getVisibleDocument } from "@/lib/document-access";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();
  const { id, taskId } = await params;
  const body = await request.json() as { evidenceDocumentId?: string; waive?: boolean };
  const now = new Date();

  const data = await db.$transaction(async (tx) => {
    const process = await tx.separationProcess.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, status: true, employmentId: true } });
    if (!process) throw new Error("NOT_FOUND");
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");
    if (process.status === "CLOSED" || process.status === "CANCELLED") throw new Error("PROCESS_CLOSED");

    const task = await tx.separationTask.findFirst({ where: { id: taskId, tenantId: ctx.tenantId, processId: id } });
    if (!task) throw new Error("TASK");
    if (body.evidenceDocumentId && !await getVisibleDocument(tx, ctx, body.evidenceDocumentId)) throw new Error("DOCUMENT");

    const status = body.waive ? ExitTaskStatus.WAIVED : ExitTaskStatus.COMPLETED;
    const updated = await tx.separationTask.update({
      where: { id: taskId },
      data: { status, evidenceDocumentId: body.evidenceDocumentId, completedAt: now, completedById: ctx.actorId }
    });
    await appendAudit(tx, ctx, { action: `offboarding.task-${status.toLowerCase()}`, resourceType: "SeparationTask", resourceId: taskId, classification: DataClassification.RESTRICTED, purpose: "Separation clearance control" });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE", "TASK", "DOCUMENT", "PROCESS_CLOSED"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
  if (data === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
  if (data === "TASK") return Response.json({ error: "Task not found in separation process." }, { status: 404 });
  if (data === "DOCUMENT") return forbidden("Evidence document is outside your authorized document scope.");
  if (data === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot be changed." }, { status: 409 });
  return Response.json({ data });
}
