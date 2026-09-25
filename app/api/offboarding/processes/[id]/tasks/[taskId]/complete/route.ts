import { AccessRevocationStatus, AssetReturnStatus, DataClassification, ExitTaskStatus, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getVisibleDocument } from "@/lib/document-access";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<ExitTaskStatus, ExitTaskStatus[]> = {
  NOT_STARTED: [ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.BLOCKED, ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED],
  IN_PROGRESS: [ExitTaskStatus.BLOCKED, ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED],
  BLOCKED: [ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED],
  COMPLETED: [],
  WAIVED: []
};

const terminalTaskStatuses: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];

function transitionRequiresReason(status: ExitTaskStatus) {
  return status === ExitTaskStatus.BLOCKED || status === ExitTaskStatus.WAIVED;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const routeParams = await params;
  const id = asIdentifier(routeParams.id);
  const taskId = asIdentifier(routeParams.taskId);
  if (!id || !taskId) return Response.json({ error: "Valid separation process and task ids are required." }, { status: 400 });

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const requested = body.status ?? (body.waive ? ExitTaskStatus.WAIVED : ExitTaskStatus.COMPLETED);
  const next = asEnumValue(requested, Object.values(ExitTaskStatus));
  if (!next) return Response.json({ error: "A valid exit task status is required." }, { status: 400 });
  const note = asOptionalText(body.note, 500);
  if (note === null) return Response.json({ error: "The transition reason must be 500 characters or fewer." }, { status: 400 });
  if (transitionRequiresReason(next) && !note) {
    return Response.json({ error: next === ExitTaskStatus.WAIVED ? "A waiver reason is required." : "A blocker reason is required." }, { status: 400 });
  }
  const evidenceDocumentId = body.evidenceDocumentId === undefined ? undefined : asIdentifier(body.evidenceDocumentId);
  if (body.evidenceDocumentId !== undefined && !evidenceDocumentId) {
    return Response.json({ error: "A valid evidence document id is required." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, employmentId: true }
      });
      if (!process) throw new Error("NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");

      const task = await tx.separationTask.findFirst({
        where: { id: taskId, tenantId: ctx.tenantId, processId: id },
        select: { id: true, status: true, title: true, domain: true, blocking: true, evidenceDocumentId: true }
      });
      if (!task) throw new Error("TASK_NOT_FOUND");
      if (!transitions[task.status].includes(next)) throw new Error("INVALID_TRANSITION");
      if (evidenceDocumentId && !await getVisibleDocument(tx, ctx, evidenceDocumentId)) throw new Error("DOCUMENT");

      const now = new Date();
      const terminal = terminalTaskStatuses.includes(next);
      const updated = await tx.separationTask.updateMany({
        where: { id: task.id, tenantId: ctx.tenantId, processId: id, status: task.status },
        data: {
          status: next,
          ...(evidenceDocumentId !== undefined ? { evidenceDocumentId } : {}),
          completedAt: terminal ? now : null,
          completedById: terminal ? ctx.actorId : null
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      const [tasks, assetsOpen, accessOpen] = await Promise.all([
        tx.separationTask.findMany({
          where: { tenantId: ctx.tenantId, processId: id },
          select: { status: true, blocking: true, domain: true }
        }),
        tx.assetReturn.count({
          where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF] } }
        }),
        tx.accessRevocation.count({
          where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION] } }
        })
      ]);

      const openBlocking = tasks.filter((item) => item.blocking && !terminalTaskStatuses.includes(item.status));
      const payrollBlocking = openBlocking.filter((item) => item.domain.trim().toUpperCase() === "PAYROLL");
      const nonPayrollBlocking = openBlocking.filter((item) => item.domain.trim().toUpperCase() !== "PAYROLL");
      const nextProcessStatus = openBlocking.length === 0 && assetsOpen === 0 && accessOpen === 0
        ? SeparationStatus.READY_TO_CLOSE
        : payrollBlocking.length > 0 && nonPayrollBlocking.length === 0 && assetsOpen === 0 && accessOpen === 0
          ? SeparationStatus.FINAL_PAY_REVIEW
          : SeparationStatus.CLEARANCE;

      if (nextProcessStatus !== process.status) {
        const processUpdate = await tx.separationProcess.updateMany({
          where: { id: process.id, tenantId: ctx.tenantId, status: process.status },
          data: { status: nextProcessStatus }
        });
        if (processUpdate.count !== 1) throw new Error("STATE_CONFLICT");
        await appendAudit(tx, ctx, {
          action: `offboarding.process-${process.status.toLowerCase()}-to-${nextProcessStatus.toLowerCase()}`,
          resourceType: "SeparationProcess",
          resourceId: process.id,
          classification: DataClassification.RESTRICTED,
          purpose: nextProcessStatus === SeparationStatus.READY_TO_CLOSE
            ? "Exit readiness gate cleared: blocking tasks, assets and access controls are complete"
            : "Separation stage recalculated from governed exit controls"
        });
      }

      await appendAudit(tx, ctx, {
        action: `offboarding.task-${task.status.toLowerCase()}-to-${next.toLowerCase()}`,
        resourceType: "SeparationTask",
        resourceId: task.id,
        classification: DataClassification.RESTRICTED,
        purpose: note ? `Separation clearance control; ${note}` : "Separation clearance control"
      });

      return { id: task.id, status: next, processId: process.id, processStatus: nextProcessStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "TASK_NOT_FOUND") return Response.json({ error: "Task not found in separation process." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot be changed." }, { status: 409 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested exit task transition is not allowed." }, { status: 409 });
    if (code === "DOCUMENT") return forbidden("Evidence document is outside your authorized document scope.");
    if (code === "STATE_CONFLICT") return Response.json({ error: "Exit task or separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return Response.json({ error: "Exit task changed concurrently. Refresh and try again." }, { status: 409 });
    }
    console.error("Offboarding task transition failed", error);
    return Response.json({ error: "Exit task status could not be changed." }, { status: 500 });
  }
}
