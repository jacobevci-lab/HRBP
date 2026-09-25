import { DataClassification, PlatformRole, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const statuses = {
  notStarted: "NOT_STARTED",
  prepared: "PREPARED",
  approved: "APPROVED",
  settled: "SETTLED"
} as const;

type SettlementAction = "PREPARE" | "APPROVE" | "SETTLE";

function normalizeAction(value: unknown): SettlementAction | null {
  const action = asText(value, 20)?.toUpperCase();
  return action === "PREPARE" || action === "APPROVE" || action === "SETTLE" ? action : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const action = normalizeAction(body.action);
  if (!action) return Response.json({ error: "action must be PREPARE, APPROVE or SETTLE." }, { status: 400 });
  const note = asOptionalText(body.note, 2000);
  if (note === null) return Response.json({ error: "note must be 2000 characters or fewer." }, { status: 400 });
  if (action === "PREPARE" && (!note || note.length < 5)) return Response.json({ error: "Preparing final settlement requires a note or evidence reference of at least 5 characters." }, { status: 400 });

  if (action === "PREPARE" && !can(ctx, "payroll:prepare")) return forbidden("Final settlement preparation requires payroll preparation authority.");
  if (action === "APPROVE" && !can(ctx, "payroll:approve")) return forbidden("Final settlement approval requires payroll approval authority.");
  if (action === "SETTLE" && !can(ctx, "payroll:pay")) return forbidden("Final settlement completion requires payroll payment authority.");

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          updatedAt: true,
          lastWorkingDate: true,
          finalSettlementStatus: true,
          finalSettlementPreparedById: true,
          finalSettlementApprovedById: true
        }
      });
      if (!process) throw new Error("PROCESS_NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");

      const current = process.finalSettlementStatus ?? statuses.notStarted;
      const now = new Date();
      let next: string;
      let update: Prisma.SeparationProcessUpdateManyMutationInput;
      let eventType: string;
      let recipientRole: PlatformRole;
      let templateKey: string;
      let auditAction: string;

      if (action === "PREPARE") {
        if (current !== statuses.notStarted) throw new Error("INVALID_TRANSITION");
        next = statuses.prepared;
        update = {
          finalSettlementStatus: next,
          finalSettlementNote: note,
          finalSettlementPreparedById: ctx.actorId,
          finalSettlementPreparedAt: now,
          finalSettlementApprovedById: null,
          finalSettlementApprovedAt: null,
          finalSettlementSettledById: null,
          finalSettlementSettledAt: null
        };
        eventType = "OFFBOARDING_FINAL_SETTLEMENT_APPROVAL_REQUIRED";
        recipientRole = PlatformRole.PAYROLL_ADMIN;
        templateKey = "offboarding.final-settlement-approval";
        auditAction = "offboarding.final-settlement-prepared";
      } else if (action === "APPROVE") {
        if (current !== statuses.prepared) throw new Error("INVALID_TRANSITION");
        if (process.finalSettlementPreparedById === ctx.actorId) throw new Error("FOUR_EYES_APPROVAL");
        next = statuses.approved;
        update = { finalSettlementStatus: next, finalSettlementApprovedById: ctx.actorId, finalSettlementApprovedAt: now };
        eventType = "OFFBOARDING_FINAL_SETTLEMENT_PAYMENT_REQUIRED";
        recipientRole = PlatformRole.PAYROLL_ADMIN;
        templateKey = "offboarding.final-settlement-payment";
        auditAction = "offboarding.final-settlement-approved";
        await tx.notificationOutbox.updateMany({
          where: { tenantId: ctx.tenantId, resourceType: "SeparationProcess", resourceId: process.id, eventType: "OFFBOARDING_FINAL_SETTLEMENT_APPROVAL_REQUIRED", readAt: null },
          data: { readAt: now }
        });
      } else {
        if (current !== statuses.approved) throw new Error("INVALID_TRANSITION");
        if (process.finalSettlementApprovedById === ctx.actorId) throw new Error("FOUR_EYES_PAYMENT");
        next = statuses.settled;
        update = { finalSettlementStatus: next, finalSettlementSettledById: ctx.actorId, finalSettlementSettledAt: now };
        eventType = "OFFBOARDING_FINAL_SETTLEMENT_SETTLED";
        recipientRole = PlatformRole.HR_OPERATIONS;
        templateKey = "offboarding.final-settlement-settled";
        auditAction = "offboarding.final-settlement-settled";
        await tx.notificationOutbox.updateMany({
          where: { tenantId: ctx.tenantId, resourceType: "SeparationProcess", resourceId: process.id, eventType: "OFFBOARDING_FINAL_SETTLEMENT_PAYMENT_REQUIRED", readAt: null },
          data: { readAt: now }
        });
      }

      const updated = await tx.separationProcess.updateMany({
        where: { id: process.id, tenantId: ctx.tenantId, updatedAt: process.updatedAt, finalSettlementStatus: process.finalSettlementStatus },
        data: update
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      const readiness = await recalculateSeparationReadiness(tx, ctx, process.id);
      await appendAudit(tx, ctx, {
        action: auditAction,
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Governed final settlement transition ${current} -> ${next}; payroll authority=${action.toLowerCase()}`
      });
      await enqueueNotificationOutbox(tx, {
        tenantId: ctx.tenantId,
        eventType,
        recipientRole,
        templateKey,
        resourceType: "SeparationProcess",
        resourceId: process.id,
        dedupeKey: `offboarding-process:${process.id}:final-settlement:${next.toLowerCase()}`,
        classification: DataClassification.RESTRICTED,
        payload: {
          separationProcessId: process.id,
          reminderState: `final-settlement-${next.toLowerCase()}`,
          finalSettlementStatus: next,
          lastWorkingDate: process.lastWorkingDate.toISOString()
        }
      });

      return { id: process.id, finalSettlementStatus: next, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separations cannot change final settlement." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested final settlement transition is not allowed from the current state." }, { status: 409 });
    if (code === "FOUR_EYES_APPROVAL") return Response.json({ error: "The payroll user who prepared final settlement cannot approve the same settlement." }, { status: 409 });
    if (code === "FOUR_EYES_PAYMENT") return Response.json({ error: "The payroll user who approved final settlement cannot mark the same settlement as settled." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Final settlement or separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "A concurrent final settlement change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding final settlement transition failed", error);
    return Response.json({ error: "Final settlement could not be updated." }, { status: 500 });
  }
}
