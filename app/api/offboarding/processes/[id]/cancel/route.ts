import { DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const reason = asText(body.reason, 2000);
  if (!reason || reason.length < 10) {
    return Response.json({ error: "Cancellation reason must be between 10 and 2000 characters." }, { status: 400 });
  }

  const scope = await resolveEmploymentScope(db, ctx);

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          finalSettlementStatus: true,
          completedAt: true
        }
      });
      if (!process) throw new Error("NOT_FOUND");
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED || process.completedAt) {
        throw new Error("TERMINAL");
      }
      if (process.finalSettlementStatus === "SETTLED") throw new Error("SETTLED");

      const now = new Date();
      const updated = await tx.separationProcess.updateMany({
        where: {
          id: process.id,
          tenantId: ctx.tenantId,
          status: process.status,
          completedAt: null,
          finalSettlementStatus: process.finalSettlementStatus
        },
        data: {
          status: SeparationStatus.CANCELLED,
          cancellationReason: reason,
          cancelledById: ctx.actorId,
          cancelledAt: now,
          completedAt: now
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      const taskIds = (await tx.separationTask.findMany({
        where: { tenantId: ctx.tenantId, processId: process.id },
        select: { id: true }
      })).map((task) => task.id);
      await tx.notificationOutbox.updateMany({
        where: {
          tenantId: ctx.tenantId,
          readAt: null,
          OR: [
            { resourceType: "SeparationProcess", resourceId: process.id },
            ...(taskIds.length ? [{ resourceType: "SeparationTask", resourceId: { in: taskIds } }] : [])
          ]
        },
        data: { readAt: now }
      });

      await appendAudit(tx, ctx, {
        action: "offboarding.process-cancelled",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Human-confirmed separation cancellation before employment termination. Reason: ${reason}`
      });

      return {
        id: process.id,
        status: SeparationStatus.CANCELLED,
        cancelledAt: now,
        cancelledById: ctx.actorId,
        cancellationReason: reason
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "TERMINAL") return Response.json({ error: "Closed or already-cancelled separation processes cannot be cancelled." }, { status: 409 });
    if (code === "SETTLED") return Response.json({ error: "A settled final payment must be formally reversed before the separation process can be cancelled." }, { status: 409 });
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) {
      return Response.json({ error: "The separation changed concurrently. Refresh and try again." }, { status: 409 });
    }
    console.error("Offboarding process cancellation failed", error);
    return Response.json({ error: "Separation process could not be cancelled." }, { status: 500 });
  }
}
