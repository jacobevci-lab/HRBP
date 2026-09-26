import { CaseActionStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getCaseWallCase } from "@/lib/case-wall";
import { asDate, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:read")) return forbidden();
  const caseId = asIdentifier((await params).id);
  if (!caseId) return Response.json({ error: "A valid case id is required." }, { status: 400 });
  if (!await getCaseWallCase(ctx, caseId)) return forbidden("Case wall denies access to this matter.");
  return Response.json({ data: await db.caseAction.findMany({ where: { tenantId: ctx.tenantId, caseId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 200 }) });
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
  const actionType = asText(body.actionType, 80);
  const description = asText(body.description, 4000);
  const ownerId = asIdentifier(body.ownerId);
  const subjectEmploymentId = body.subjectEmploymentId === undefined || body.subjectEmploymentId === null || body.subjectEmploymentId === "" ? null : asIdentifier(body.subjectEmploymentId);
  const dueAt = body.dueAt === undefined || body.dueAt === null || body.dueAt === "" ? null : asDate(body.dueAt);
  if (!actionType || !description || !ownerId) return Response.json({ error: "actionType (1–80), description (1–4000) and ownerId are required." }, { status: 400 });
  if (body.subjectEmploymentId && !subjectEmploymentId) return Response.json({ error: "subjectEmploymentId must be a valid identifier." }, { status: 400 });
  if (body.dueAt && !dueAt) return Response.json({ error: "dueAt must be a valid date value." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const caseRecord = await getCaseWallCase(ctx, caseId, tx);
    if (!caseRecord) throw new Error("CASE_WALL");
    const owner = await tx.userAccount.findFirst({ where: { id: ownerId, tenantId: ctx.tenantId, active: true }, select: { id: true } });
    if (!owner) throw new Error("OWNER");
    if (subjectEmploymentId) {
      if (!caseRecord.subjectPersonId) throw new Error("SUBJECT");
      const employment = await tx.employment.findFirst({ where: { id: subjectEmploymentId, tenantId: ctx.tenantId, personId: caseRecord.subjectPersonId }, select: { id: true } });
      if (!employment) throw new Error("SUBJECT");
    }
    const action = await tx.caseAction.create({
      data: { tenantId: ctx.tenantId, caseId, subjectEmploymentId, actionType, description, ownerId, dueAt, status: CaseActionStatus.OPEN }
    });
    await appendAudit(tx, ctx, {
      action: "employee-case.corrective-action-created",
      resourceType: "CaseAction",
      resourceId: action.id,
      classification: DataClassification.HIGHLY_RESTRICTED,
      purpose: "Governed corrective action created inside the restricted case wall"
    });
    if (ownerId !== ctx.actorId) {
      await enqueueNotificationOutbox(tx, {
        tenantId: ctx.tenantId,
        eventType: "ER_CASE_ACTION_ASSIGNED",
        recipientUserId: ownerId,
        templateKey: "employee-relations.action-assigned",
        resourceType: "CaseAction",
        resourceId: action.id,
        dedupeKey: `employee-case:${caseId}:action:${action.id}:assigned`,
        classification: DataClassification.HIGHLY_RESTRICTED,
        payload: { notificationState: "case-action-assigned", caseNumber: caseRecord.caseNumber, dueAt: dueAt?.toISOString() ?? null }
      });
    }
    return action;
  }).catch((error) => error instanceof Error && ["CASE_WALL", "OWNER", "SUBJECT"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
  if (data === "OWNER") return Response.json({ error: "Action owner must be an active user in this tenant." }, { status: 400 });
  if (data === "SUBJECT") return Response.json({ error: "subjectEmploymentId must belong to the case subject in this tenant." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
