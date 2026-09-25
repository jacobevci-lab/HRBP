import { CaseAppealStatus, CaseActionStatus, CaseStatus, DataClassification, AllegationStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { getCaseWallCase } from "@/lib/case-wall";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<CaseStatus, CaseStatus[]> = {
  DRAFT: [CaseStatus.OPEN],
  OPEN: [CaseStatus.INVESTIGATING],
  INVESTIGATING: [CaseStatus.ACTION_REQUIRED, CaseStatus.RESOLVED],
  ACTION_REQUIRED: [CaseStatus.INVESTIGATING, CaseStatus.RESOLVED],
  RESOLVED: [CaseStatus.INVESTIGATING, CaseStatus.CLOSED],
  CLOSED: []
};
const reasonStatuses = new Set<CaseStatus>([CaseStatus.ACTION_REQUIRED, CaseStatus.RESOLVED, CaseStatus.CLOSED]);
const activeAllegationStatuses = [AllegationStatus.OPEN, AllegationStatus.INVESTIGATING];
const activeActionStatuses = [CaseActionStatus.OPEN, CaseActionStatus.IN_PROGRESS];
const activeAppealStatuses = [CaseAppealStatus.SUBMITTED, CaseAppealStatus.REVIEWING];

function statusLabel(value: CaseStatus) {
  return value.toLowerCase().replace(/_/g, " ");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();

  const caseId = asIdentifier((await params).id);
  if (!caseId) return Response.json({ error: "A valid case id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const nextStatus = asEnumValue(body.status, Object.values(CaseStatus));
  if (!nextStatus) return Response.json({ error: "A valid case status is required." }, { status: 400 });
  const reasonInput = asOptionalText(body.reason, 2000);
  if (reasonInput === null) return Response.json({ error: "reason must be at most 2000 characters." }, { status: 400 });
  const reason = reasonInput ?? null;

  try {
    const data = await db.$transaction(async (tx) => {
      const current = await getCaseWallCase(ctx, caseId, tx);
      if (!current) throw new Error("CASE_WALL");
      if (nextStatus === current.status) throw new Error("NO_CHANGE");
      if (!transitions[current.status].includes(nextStatus)) throw new Error("INVALID_TRANSITION");
      const reopening = current.status === CaseStatus.RESOLVED && nextStatus === CaseStatus.INVESTIGATING;
      if ((reasonStatuses.has(nextStatus) || reopening) && (!reason || reason.length < 10)) throw new Error("REASON");

      const [openAllegations, openActions, activeAppeals] = await Promise.all([
        tx.caseAllegation.count({ where: { tenantId: ctx.tenantId, caseId, status: { in: activeAllegationStatuses } } }),
        tx.caseAction.count({ where: { tenantId: ctx.tenantId, caseId, status: { in: activeActionStatuses } } }),
        tx.caseAppeal.count({ where: { tenantId: ctx.tenantId, caseId, status: { in: activeAppealStatuses } } })
      ]);

      if (nextStatus === CaseStatus.RESOLVED && (openAllegations || openActions)) {
        throw new Error(`RESOLUTION_BLOCKED:${openAllegations}:${openActions}`);
      }
      if (nextStatus === CaseStatus.CLOSED && (openAllegations || openActions || activeAppeals)) {
        throw new Error(`CLOSURE_BLOCKED:${openAllegations}:${openActions}:${activeAppeals}`);
      }

      const now = new Date();
      const updated = await tx.employeeCase.updateMany({
        where: { id: current.id, tenantId: ctx.tenantId, status: current.status, closedAt: current.closedAt },
        data: { status: nextStatus, closedAt: nextStatus === CaseStatus.CLOSED ? now : null }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      await tx.employeeCaseStatusTransition.create({
        data: {
          tenantId: ctx.tenantId,
          caseId: current.id,
          fromStatus: current.status,
          toStatus: nextStatus,
          reason,
          actorId: ctx.actorId,
          occurredAt: now
        }
      });
      await appendAudit(tx, ctx, {
        action: `employee-case.${nextStatus.toLowerCase()}`,
        resourceType: "EmployeeCase",
        resourceId: current.id,
        classification: DataClassification.HIGHLY_RESTRICTED,
        purpose: `${statusLabel(current.status)} -> ${statusLabel(nextStatus)}${reason ? `; reason: ${reason}` : ""}`
      });

      const assignmentUserIds = (await tx.caseAssignment.findMany({
        where: { caseId: current.id },
        select: { userId: true }
      })).map((item) => item.userId);
      const recipients = [...new Set([current.ownerUserId, ...assignmentUserIds])].filter((userId) => userId !== ctx.actorId);
      for (const recipientUserId of recipients) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "ER_CASE_STATUS_CHANGED",
          recipientUserId,
          templateKey: "employee-relations.case-status-changed",
          resourceType: "EmployeeCase",
          resourceId: current.id,
          dedupeKey: `employee-case:${current.id}:status:${nextStatus}:${now.toISOString()}:${recipientUserId}`,
          classification: DataClassification.HIGHLY_RESTRICTED,
          payload: {
            notificationState: "case-status-changed",
            caseNumber: current.caseNumber,
            fromStatus: current.status,
            toStatus: nextStatus
          }
        });
      }

      return {
        id: current.id,
        caseNumber: current.caseNumber,
        status: nextStatus,
        closedAt: nextStatus === CaseStatus.CLOSED ? now : null,
        blockers: { openAllegations, openActions, activeAppeals }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
    if (code === "NO_CHANGE") return Response.json({ error: "The case is already in that status." }, { status: 409 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested case lifecycle transition is not allowed." }, { status: 409 });
    if (code === "REASON") return Response.json({ error: "A reason of 10–2000 characters is required for action-required, resolution, closure and reopen transitions." }, { status: 400 });
    if (code.startsWith("RESOLUTION_BLOCKED:")) {
      const [, allegations, actions] = code.split(":");
      return Response.json({ error: "Case cannot be resolved while investigative work remains open.", blockers: { allegations: Number(allegations), actions: Number(actions) } }, { status: 409 });
    }
    if (code.startsWith("CLOSURE_BLOCKED:")) {
      const [, allegations, actions, appeals] = code.split(":");
      return Response.json({ error: "Case cannot be closed while allegations, corrective actions or appeals remain active.", blockers: { allegations: Number(allegations), actions: Number(actions), appeals: Number(appeals) } }, { status: 409 });
    }
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) {
      return Response.json({ error: "The case changed concurrently. Refresh and try again." }, { status: 409 });
    }
    console.error("Employee relations case transition failed", error);
    return Response.json({ error: "Case status could not be updated." }, { status: 500 });
  }
}
