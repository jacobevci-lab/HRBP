import { AccessRevocationStatus, AssetReturnStatus, DataClassification, EmploymentStatus, ExitTaskStatus, LifecycleEventType, PositionStatus, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const terminableEmploymentStatuses: EmploymentStatus[] = [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED];
const incumbentStatuses: EmploymentStatus[] = [EmploymentStatus.PREBOARDING, EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED];
const activeDirectReportStatuses: EmploymentStatus[] = [EmploymentStatus.PREBOARDING, EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, employmentId: true, initiatedById: true, lastWorkingDate: true, type: true, completedAt: true, finalSettlementStatus: true }
      });
      if (!process) throw new Error("NOT_FOUND");
      if (process.status !== SeparationStatus.READY_TO_CLOSE || process.completedAt) throw new Error("NOT_READY");
      if (process.finalSettlementStatus !== "SETTLED") throw new Error("FINAL_SETTLEMENT");
      if (process.initiatedById === ctx.actorId) throw new Error("FOUR_EYES");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");
      const now = new Date();
      if (process.lastWorkingDate > now) throw new Error("LAST_DAY_NOT_REACHED");

      const [blockingTasks, assets, access, knowledgeTransfers, directReports, employment] = await Promise.all([
        tx.separationTask.count({ where: { tenantId: ctx.tenantId, processId: id, blocking: true, status: { notIn: [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED] } } }),
        tx.assetReturn.count({ where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF] } } }),
        tx.accessRevocation.count({ where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION] } } }),
        tx.knowledgeTransfer.count({ where: { tenantId: ctx.tenantId, processId: id, status: { notIn: [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED] } } }),
        tx.employment.count({ where: { tenantId: ctx.tenantId, managerEmploymentId: process.employmentId, status: { in: activeDirectReportStatuses } } }),
        tx.employment.findFirst({ where: { id: process.employmentId, tenantId: ctx.tenantId }, select: { id: true, personId: true, status: true, positionId: true } })
      ]);
      if (!employment) throw new Error("EMPLOYMENT");
      if (!terminableEmploymentStatuses.includes(employment.status)) throw new Error("EMPLOYMENT_STATE");
      if (blockingTasks || assets || access || knowledgeTransfers || directReports) throw new Error(`BLOCKED:${blockingTasks}:${assets}:${access}:${knowledgeTransfers}:${directReports}`);

      const employmentUpdate = await tx.employment.updateMany({ where: { id: employment.id, tenantId: ctx.tenantId, status: employment.status }, data: { status: EmploymentStatus.TERMINATED, endDate: process.lastWorkingDate } });
      if (employmentUpdate.count !== 1) throw new Error("STATE_CONFLICT");
      const processUpdate = await tx.separationProcess.updateMany({ where: { id: process.id, tenantId: ctx.tenantId, status: SeparationStatus.READY_TO_CLOSE, completedAt: null, finalSettlementStatus: "SETTLED" }, data: { status: SeparationStatus.CLOSED, completedAt: now } });
      if (processUpdate.count !== 1) throw new Error("STATE_CONFLICT");

      await tx.notificationOutbox.updateMany({
        where: {
          tenantId: ctx.tenantId,
          resourceType: "SeparationProcess",
          resourceId: process.id,
          eventType: { in: ["OFFBOARDING_READY_TO_CLOSE", "OFFBOARDING_EXIT_READINESS_RISK", "OFFBOARDING_FINAL_SETTLEMENT_SETTLED"] },
          readAt: null
        },
        data: { readAt: now }
      });

      if (employment.positionId) {
        const remainingIncumbents = await tx.employment.count({ where: { tenantId: ctx.tenantId, positionId: employment.positionId, id: { not: employment.id }, status: { in: incumbentStatuses } } });
        if (remainingIncumbents === 0) await tx.position.updateMany({ where: { id: employment.positionId, tenantId: ctx.tenantId, status: PositionStatus.FILLED }, data: { status: PositionStatus.OPEN } });
      }

      await tx.employeeLifecycleEvent.create({ data: { tenantId: ctx.tenantId, personId: employment.personId, employmentId: employment.id, type: LifecycleEventType.TERMINATED, effectiveAt: process.lastWorkingDate, summary: `Separation completed (${process.type})`, actorId: ctx.actorId } });
      await appendAudit(tx, ctx, { action: "employment.exit-terminated", resourceType: "Employment", resourceId: employment.id, classification: DataClassification.RESTRICTED, purpose: "Human-confirmed employment termination after governed exit readiness and settled final pay" });
      await appendAudit(tx, ctx, { action: "offboarding.process-closed", resourceType: "SeparationProcess", resourceId: id, classification: DataClassification.RESTRICTED, purpose: "Four-eyes separation closure after task, manager handover, knowledge transfer, asset, access, final settlement and last-working-date gates cleared" });
      return { id, status: SeparationStatus.CLOSED, employmentStatus: EmploymentStatus.TERMINATED, endDate: process.lastWorkingDate };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "NOT_READY") return Response.json({ error: "Separation must be in Ready to Close state before employment can be terminated." }, { status: 409 });
    if (code === "FINAL_SETTLEMENT") return Response.json({ error: "Final settlement must be independently approved and settled before employment termination." }, { status: 409 });
    if (code === "FOUR_EYES") return Response.json({ error: "The person who initiated the separation cannot perform the final employment termination." }, { status: 409 });
    if (code === "LAST_DAY_NOT_REACHED") return Response.json({ error: "Employment cannot be terminated before the governed last working date." }, { status: 409 });
    if (code === "EMPLOYMENT") return Response.json({ error: "Employment record not found." }, { status: 409 });
    if (code === "EMPLOYMENT_STATE") return Response.json({ error: "Employment is not in a state that can be terminated by this separation." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Separation or employment state changed concurrently. Refresh and try again." }, { status: 409 });
    if (code.startsWith("BLOCKED:")) { const [, tasks, assets, access, knowledgeTransfers, directReports] = code.split(":"); return Response.json({ error: "Clearance is incomplete.", open: { tasks: Number(tasks), assets: Number(assets), access: Number(access), knowledgeTransfers: Number(knowledgeTransfers), directReports: Number(directReports) } }, { status: 409 }); }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Separation changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offboarding close failed", error);
    return Response.json({ error: "Separation could not be closed." }, { status: 500 });
  }
}
