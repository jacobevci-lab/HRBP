import { CaseAppealStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { getCaseWallCase } from "@/lib/case-wall";
import { db } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; appealId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();

  const resolved = await params;
  const caseId = asIdentifier(resolved.id);
  const appealId = asIdentifier(resolved.appealId);
  if (!caseId || !appealId) return Response.json({ error: "Valid case and appeal ids are required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const caseRecord = await getCaseWallCase(ctx, caseId, tx);
      if (!caseRecord) throw new Error("CASE_WALL");

      const appeal = await tx.caseAppeal.findFirst({
        where: { id: appealId, caseId, tenantId: ctx.tenantId },
        select: { id: true, status: true, reviewerId: true, requestedById: true }
      });
      if (!appeal) throw new Error("NOT_FOUND");
      if (appeal.reviewerId !== ctx.actorId) throw new Error("NOT_REVIEWER");
      if (appeal.status !== CaseAppealStatus.SUBMITTED) throw new Error("INVALID_STATE");

      const updated = await tx.caseAppeal.updateMany({
        where: { id: appeal.id, caseId, tenantId: ctx.tenantId, reviewerId: ctx.actorId, status: CaseAppealStatus.SUBMITTED },
        data: { status: CaseAppealStatus.REVIEWING }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "employee-case.appeal-review-started",
        resourceType: "CaseAppeal",
        resourceId: appeal.id,
        classification: DataClassification.HIGHLY_RESTRICTED,
        purpose: "Assigned appeal reviewer started governed review"
      });

      if (appeal.requestedById !== ctx.actorId) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "ER_CASE_APPEAL_REVIEW_STARTED",
          recipientUserId: appeal.requestedById,
          resourceType: "CaseAppeal",
          resourceId: appeal.id,
          dedupeKey: `employee-case:${caseId}:appeal:${appeal.id}:review-started`,
          classification: DataClassification.HIGHLY_RESTRICTED,
          payload: { notificationState: "appeal-review-started", caseNumber: caseRecord.caseNumber }
        });
      }

      return { id: appeal.id, status: CaseAppealStatus.REVIEWING };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
    if (code === "NOT_FOUND") return Response.json({ error: "Appeal not found in this case." }, { status: 404 });
    if (code === "NOT_REVIEWER") return forbidden("Only the assigned appeal reviewer can start review.");
    if (code === "INVALID_STATE" || code === "STATE_CONFLICT") return Response.json({ error: "This appeal is no longer waiting to be reviewed." }, { status: 409 });
    console.error("Employee relations appeal review start failed", error);
    return Response.json({ error: "Appeal review could not be started." }, { status: 500 });
  }
}
