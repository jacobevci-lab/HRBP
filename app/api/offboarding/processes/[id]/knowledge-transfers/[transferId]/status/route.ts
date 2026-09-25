import { DataClassification, ExitTaskStatus, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<ExitTaskStatus, ExitTaskStatus[]> = {
  NOT_STARTED: [ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.COMPLETED],
  IN_PROGRESS: [ExitTaskStatus.COMPLETED],
  BLOCKED: [ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.COMPLETED],
  COMPLETED: [],
  WAIVED: []
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string; transferId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const route = await params;
  const processId = asIdentifier(route.id);
  const transferId = asIdentifier(route.transferId);
  if (!processId || !transferId) return Response.json({ error: "Valid separation process and knowledge-transfer ids are required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = asEnumValue(body.status, Object.values(ExitTaskStatus));
  if (!next || (next !== ExitTaskStatus.IN_PROGRESS && next !== ExitTaskStatus.COMPLETED)) {
    return Response.json({ error: "Knowledge transfers can only move to In Progress or Completed." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: { id: true, status: true, employmentId: true }
      });
      if (!process) throw new Error("PROCESS_NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");

      const transfer = await tx.knowledgeTransfer.findFirst({
        where: { id: transferId, tenantId: ctx.tenantId, processId },
        select: { id: true, status: true, title: true }
      });
      if (!transfer) throw new Error("TRANSFER_NOT_FOUND");
      if (!transitions[transfer.status].includes(next)) throw new Error("INVALID_TRANSITION");

      const now = new Date();
      const updated = await tx.knowledgeTransfer.updateMany({
        where: { id: transfer.id, tenantId: ctx.tenantId, processId, status: transfer.status },
        data: { status: next, completedAt: next === ExitTaskStatus.COMPLETED ? now : null }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      const readiness = await recalculateSeparationReadiness(tx, ctx, processId);
      await appendAudit(tx, ctx, {
        action: `offboarding.knowledge-transfer-${transfer.status.toLowerCase()}-to-${next.toLowerCase()}`,
        resourceType: "KnowledgeTransfer",
        resourceId: transfer.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Human-confirmed knowledge transfer lifecycle: ${transfer.title}`
      });
      return { id: transfer.id, status: next, processId, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot change knowledge transfers." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "TRANSFER_NOT_FOUND") return Response.json({ error: "Knowledge transfer record not found." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested knowledge-transfer transition is not allowed." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Knowledge transfer or separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Knowledge-transfer state changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offboarding knowledge transfer transition failed", error);
    return Response.json({ error: "Knowledge transfer status could not be changed." }, { status: 500 });
  }
}
