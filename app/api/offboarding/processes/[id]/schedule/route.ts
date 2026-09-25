import { AccessRevocationStatus, DataClassification, ExitTaskStatus, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const OPEN_TASK_STATUSES: ExitTaskStatus[] = [ExitTaskStatus.NOT_STARTED, ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.BLOCKED];
const STALE_PROCESS_EVENTS = ["OFFBOARDING_EXIT_READINESS_RISK", "OFFBOARDING_READY_TO_CLOSE"];
const STALE_TASK_EVENTS = ["OFFBOARDING_TASK_BLOCKED", "OFFBOARDING_TASK_DUE_SOON", "OFFBOARDING_TASK_OVERDUE"];
const DAY_MS = 24 * 60 * 60 * 1000;

function sameInstant(left: Date | null, right: Date | null) {
  if (!left || !right) return left === right;
  return left.getTime() === right.getTime();
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const noticeDate = asDate(body.noticeDate);
  const lastWorkingDate = asDate(body.lastWorkingDate);
  const reason = asText(body.reason, 2000);
  if (!noticeDate || !lastWorkingDate) return Response.json({ error: "noticeDate and lastWorkingDate must be valid date values." }, { status: 400 });
  if (!reason || reason.length < 10) return Response.json({ error: "Schedule amendments require a reason between 10 and 2000 characters." }, { status: 400 });
  if (lastWorkingDate < noticeDate) return Response.json({ error: "lastWorkingDate cannot be before noticeDate." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          updatedAt: true,
          noticeDate: true,
          lastWorkingDate: true,
          finalSettlementStatus: true
        }
      });
      if (!process) throw new Error("PROCESS_NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");
      if (process.finalSettlementStatus === "SETTLED") throw new Error("SETTLEMENT_SETTLED");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (sameInstant(process.noticeDate, noticeDate) && sameInstant(process.lastWorkingDate, lastWorkingDate)) throw new Error("NO_CHANGE");

      const deltaMs = lastWorkingDate.getTime() - process.lastWorkingDate.getTime();
      const scheduledAccess = await tx.accessRevocation.findMany({
        where: { tenantId: ctx.tenantId, processId, status: AccessRevocationStatus.SCHEDULED, scheduledAt: { not: null } },
        select: { id: true, systemName: true, scheduledAt: true }
      });
      const shiftedAccess = scheduledAccess.map((access) => ({
        ...access,
        shiftedAt: new Date((access.scheduledAt as Date).getTime() + deltaMs)
      }));
      const invalidAccess = shiftedAccess.filter((access) => access.shiftedAt > new Date(lastWorkingDate.getTime() + DAY_MS));
      if (invalidAccess.length) throw new Error(`ACCESS_SCHEDULE_CONFLICT:${invalidAccess.map((item) => item.systemName).slice(0, 5).join(", ")}`);

      const alignedTasks = await tx.separationTask.findMany({
        where: { tenantId: ctx.tenantId, processId, status: { in: OPEN_TASK_STATUSES }, dueAt: process.lastWorkingDate },
        select: { id: true }
      });
      const alignedTransfers = await tx.knowledgeTransfer.findMany({
        where: { tenantId: ctx.tenantId, processId, status: { in: OPEN_TASK_STATUSES }, dueAt: process.lastWorkingDate },
        select: { id: true }
      });

      const updated = await tx.separationProcess.updateMany({
        where: { id: process.id, tenantId: ctx.tenantId, status: process.status, updatedAt: process.updatedAt },
        data: { noticeDate, lastWorkingDate }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      if (alignedTasks.length) {
        await tx.separationTask.updateMany({
          where: { tenantId: ctx.tenantId, processId, id: { in: alignedTasks.map((item) => item.id) }, status: { in: OPEN_TASK_STATUSES } },
          data: { dueAt: lastWorkingDate }
        });
      }
      if (alignedTransfers.length) {
        await tx.knowledgeTransfer.updateMany({
          where: { tenantId: ctx.tenantId, processId, id: { in: alignedTransfers.map((item) => item.id) }, status: { in: OPEN_TASK_STATUSES } },
          data: { dueAt: lastWorkingDate }
        });
      }
      for (const access of shiftedAccess) {
        const accessUpdated = await tx.accessRevocation.updateMany({
          where: { id: access.id, tenantId: ctx.tenantId, processId, status: AccessRevocationStatus.SCHEDULED, scheduledAt: access.scheduledAt },
          data: { scheduledAt: access.shiftedAt }
        });
        if (accessUpdated.count !== 1) throw new Error("STATE_CONFLICT");
      }

      const amendment = await tx.separationScheduleAmendment.create({
        data: {
          tenantId: ctx.tenantId,
          processId,
          previousNoticeDate: process.noticeDate,
          newNoticeDate: noticeDate,
          previousLastWorkingDate: process.lastWorkingDate,
          newLastWorkingDate: lastWorkingDate,
          reason,
          changedById: ctx.actorId
        },
        select: { id: true, changedAt: true }
      });

      const now = new Date();
      await tx.notificationOutbox.updateMany({
        where: {
          tenantId: ctx.tenantId,
          resourceType: "SeparationProcess",
          resourceId: process.id,
          eventType: { in: STALE_PROCESS_EVENTS },
          readAt: null
        },
        data: { readAt: now }
      });
      if (alignedTasks.length) {
        await tx.notificationOutbox.updateMany({
          where: {
            tenantId: ctx.tenantId,
            resourceType: "SeparationTask",
            resourceId: { in: alignedTasks.map((item) => item.id) },
            eventType: { in: STALE_TASK_EVENTS },
            readAt: null
          },
          data: { readAt: now }
        });
      }

      const readiness = await recalculateSeparationReadiness(tx, ctx, process.id);
      await appendAudit(tx, ctx, {
        action: "offboarding.schedule-amended",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Governed exit schedule amendment; notice ${process.noticeDate?.toISOString() ?? "none"} -> ${noticeDate.toISOString()}; last day ${process.lastWorkingDate.toISOString()} -> ${lastWorkingDate.toISOString()}; reason=${reason}`
      });

      return {
        id: process.id,
        amendmentId: amendment.id,
        changedAt: amendment.changedAt.toISOString(),
        noticeDate: noticeDate.toISOString(),
        lastWorkingDate: lastWorkingDate.toISOString(),
        processStatus: readiness.processStatus,
        synchronized: {
          tasks: alignedTasks.length,
          knowledgeTransfers: alignedTransfers.length,
          accessSchedules: shiftedAccess.length
        }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation schedules cannot be amended." }, { status: 409 });
    if (code === "SETTLEMENT_SETTLED") return Response.json({ error: "Settled final payment must be reversed before the governed exit schedule can change." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "NO_CHANGE") return Response.json({ error: "The requested schedule is identical to the current separation schedule." }, { status: 409 });
    if (code.startsWith("ACCESS_SCHEDULE_CONFLICT:")) return Response.json({ error: `Access revocation schedule conflicts with the amended exit date: ${code.slice("ACCESS_SCHEDULE_CONFLICT:".length)}.` }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Separation schedule or dependent controls changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "A concurrent separation schedule change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding schedule amendment failed", error);
    return Response.json({ error: "Separation schedule could not be amended." }, { status: 500 });
  }
}
