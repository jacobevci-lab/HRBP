import { CaseActionStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getCaseWallCase } from "@/lib/case-wall";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:read")) return forbidden();
  const { id } = await params;
  if (!await getCaseWallCase(ctx, id)) return forbidden("Case wall denies access to this matter.");
  return Response.json({ data: await db.caseAction.findMany({ where: { tenantId: ctx.tenantId, caseId: id }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] }) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { actionType?: string; description?: string; ownerId?: string; dueAt?: string; subjectEmploymentId?: string };
  const actionType = body.actionType?.trim();
  const description = body.description?.trim();
  const ownerId = body.ownerId?.trim();
  if (!actionType || !description || !ownerId) return Response.json({ error: "actionType, description and ownerId are required." }, { status: 400 });
  const dueAt = body.dueAt ? new Date(body.dueAt) : undefined;
  if (dueAt && Number.isNaN(dueAt.getTime())) return Response.json({ error: "dueAt must be a valid date value." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const caseRecord = await getCaseWallCase(ctx, id, tx);
    if (!caseRecord) throw new Error("CASE_WALL");
    const owner = await tx.userAccount.findFirst({ where: { id: ownerId, tenantId: ctx.tenantId, active: true }, select: { id: true } });
    if (!owner) throw new Error("OWNER");
    if (body.subjectEmploymentId) {
      if (!caseRecord.subjectPersonId) throw new Error("SUBJECT");
      const employment = await tx.employment.findFirst({
        where: { id: body.subjectEmploymentId, tenantId: ctx.tenantId, personId: caseRecord.subjectPersonId },
        select: { id: true }
      });
      if (!employment) throw new Error("SUBJECT");
    }
    const action = await tx.caseAction.create({
      data: {
        tenantId: ctx.tenantId,
        caseId: id,
        subjectEmploymentId: body.subjectEmploymentId,
        actionType,
        description,
        ownerId,
        dueAt,
        status: CaseActionStatus.OPEN
      }
    });
    await appendAudit(tx, ctx, { action: "employee-case.corrective-action-created", resourceType: "CaseAction", resourceId: action.id, classification: DataClassification.HIGHLY_RESTRICTED });
    return action;
  }).catch((error) => error instanceof Error && ["CASE_WALL", "OWNER", "SUBJECT"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
  if (data === "OWNER") return Response.json({ error: "Action owner must be an active user in this tenant." }, { status: 400 });
  if (data === "SUBJECT") return Response.json({ error: "subjectEmploymentId must belong to the case subject in this tenant." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
