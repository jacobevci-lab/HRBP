import { AccessRevocationStatus, AssetReturnStatus, DataClassification, EmploymentStatus, ExitTaskStatus, LifecycleEventType, PositionStatus, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const process = await tx.separationProcess.findFirst({
      where: { id, tenantId: ctx.tenantId, status: { notIn: [SeparationStatus.CLOSED, SeparationStatus.CANCELLED] } }
    });
    if (!process) throw new Error("NOT_FOUND");

    const [blockingTasks, assets, access, employment] = await Promise.all([
      tx.separationTask.count({ where: { tenantId: ctx.tenantId, processId: id, blocking: true, status: { notIn: [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED] } } }),
      tx.assetReturn.count({ where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF] } } }),
      tx.accessRevocation.count({ where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION] } } }),
      tx.employment.findFirst({ where: { id: process.employmentId, tenantId: ctx.tenantId }, select: { id: true, personId: true, status: true, positionId: true } })
    ]);

    if (!employment) throw new Error("EMPLOYMENT");
    if (blockingTasks || assets || access) throw new Error(`BLOCKED:${blockingTasks}:${assets}:${access}`);

    const now = new Date();
    await tx.separationProcess.update({
      where: { id: process.id, tenantId: ctx.tenantId },
      data: { status: SeparationStatus.CLOSED, completedAt: now }
    });
    await tx.employment.update({
      where: { id: employment.id, tenantId: ctx.tenantId },
      data: { status: EmploymentStatus.TERMINATED, endDate: process.lastWorkingDate }
    });
    if (employment.positionId) {
      await tx.position.update({
        where: { id: employment.positionId, tenantId: ctx.tenantId },
        data: { status: PositionStatus.OPEN }
      });
    }
    await tx.employeeLifecycleEvent.create({
      data: {
        tenantId: ctx.tenantId,
        personId: employment.personId,
        employmentId: employment.id,
        type: LifecycleEventType.TERMINATED,
        effectiveAt: process.lastWorkingDate,
        summary: `Separation completed (${process.type})`,
        actorId: ctx.actorId
      }
    });
    await appendAudit(tx, ctx, {
      action: "offboarding.process-closed",
      resourceType: "SeparationProcess",
      resourceId: id,
      classification: DataClassification.RESTRICTED,
      purpose: "Governed separation closure"
    });
    return { id, status: SeparationStatus.CLOSED, employmentStatus: EmploymentStatus.TERMINATED, endDate: process.lastWorkingDate };
  }).catch((error) => error instanceof Error && (error.message === "NOT_FOUND" || error.message === "EMPLOYMENT" || error.message.startsWith("BLOCKED:")) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Open separation process not found." }, { status: 404 });
  if (data === "EMPLOYMENT") return Response.json({ error: "Employment record not found." }, { status: 409 });
  if (typeof data === "string" && data.startsWith("BLOCKED:")) {
    const [, tasks, assets, access] = data.split(":");
    return Response.json({ error: "Clearance is incomplete.", open: { tasks: Number(tasks), assets: Number(assets), access: Number(access) } }, { status: 409 });
  }
  return Response.json({ data });
}
