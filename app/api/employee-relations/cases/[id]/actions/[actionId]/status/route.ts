import { CaseActionStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { getCaseWallCase } from "@/lib/case-wall";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<CaseActionStatus, CaseActionStatus[]> = {
  OPEN: [CaseActionStatus.IN_PROGRESS, CaseActionStatus.COMPLETED, CaseActionStatus.CANCELLED],
  IN_PROGRESS: [CaseActionStatus.COMPLETED, CaseActionStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: []
};
const terminal = new Set<CaseActionStatus>([CaseActionStatus.COMPLETED, CaseActionStatus.CANCELLED]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string; actionId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();

  const resolvedParams = await params;
  const caseId = asIdentifier(resolvedParams.id);
  const actionId = asIdentifier(resolvedParams.actionId);
  if (!caseId || !actionId) return Response.json({ error: "Valid case and action ids are required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const nextStatus = asEnumValue(body.status, Object.values(CaseActionStatus));
  if (!nextStatus) return Response.json({ error: "A valid corrective-action status is required." }, { status: 400 });
  const reasonInput = asOptionalText(body.reason, 2000);
  if (reasonInput === null) return Response.json({ error: "reason must be at most 2000 characters." }, { status: 400 });
  const reason = reasonInput ?? null;

  try {
    const data = await db.$transaction(async (tx) => {
      const caseRecord = await getCaseWallCase(ctx, caseId, tx);
      if (!caseRecord) throw new Error("CASE_WALL");
      const action = await tx.caseAction.findFirst({ where: { id: actionId, caseId, tenantId: ctx.tenantId } });
      if (!action) throw new Error("NOT_FOUND");
      if (nextStatus === action.status) throw new Error("NO_CHANGE");
      if (!transitions[action.status].includes(nextStatus)) throw new Error("INVALID_TRANSITION");
      if (terminal.has(nextStatus) && (!reason || reason.length < 10)) throw new Error("REASON");

      const now = new Date();
      const updated = await tx.caseAction.updateMany({
        where: { id: action.id, caseId, tenantId: ctx.tenantId, status: action.status, completedAt: action.completedAt },
        data: { status: nextStatus, completedAt: nextStatus === CaseActionStatus.COMPLETED ? now : null }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      await tx.caseActionStatusTransition.create({
        data: {
          tenantId: ctx.tenantId,
          caseId,
          actionId: action.id,
          fromStatus: action.status,
          toStatus: nextStatus,
          reason,
          actorId: ctx.actorId,
          occurredAt: now
        }
      });
      await appendAudit(tx, ctx, {
        action: `employee-case.corrective-action-${nextStatus.toLowerCase()}`,
        resourceType: "CaseAction",
        resourceId: action.id,
        classification: DataClassification.HIGHLY_RESTRICTED,
        purpose: `${action.status.toLowerCase()} -> ${nextStatus.toLowerCase()}${reason ? `; reason: ${reason}` : ""}`
      });

      if (action.ownerId !== ctx.actorId) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "ER_CASE_ACTION_STATUS_CHANGED",
          recipientUserId: action.ownerId,
          templateKey: "employee-relations.action-status-changed",
          resourceType: "CaseAction",
          resourceId: action.id,
          dedupeKey: `employee-case:${caseId}:action:${action.id}:status:${nextStatus}:${now.toISOString()}`,
          classification: DataClassification.HIGHLY_RESTRICTED,
          payload: { notificationState: "case-action-status-changed", caseNumber: caseRecord.caseNumber, fromStatus: action.status, toStatus: nextStatus }
        });
      }

      return { id: action.id, status: nextStatus, completedAt: nextStatus === CaseActionStatus.COMPLETED ? now : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
    if (code === "NOT_FOUND") return Response.json({ error: "Corrective action not found in this case." }, { status: 404 });
    if (code === "NO_CHANGE") return Response.json({ error: "Corrective action is already in that status." }, { status: 409 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested corrective-action transition is not allowed." }, { status: 409 });
    if (code === "REASON") return Response.json({ error: "A reason of 10–2000 characters is required to complete or cancel a corrective action." }, { status: 400 });
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) return Response.json({ error: "The corrective action changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Employee relations corrective action transition failed", error);
    return Response.json({ error: "Corrective action could not be updated." }, { status: 500 });
  }
}
