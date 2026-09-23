import { CaseAppealStatus, DataClassification } from "@prisma/client";
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
  return Response.json({ data: await db.caseAppeal.findMany({ where: { tenantId: ctx.tenantId, caseId: id }, orderBy: { submittedAt: "desc" } }) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { grounds?: string };
  const grounds = body.grounds?.trim();
  if (!grounds) return Response.json({ error: "grounds are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    if (!await getCaseWallCase(ctx, id, tx)) throw new Error("CASE_WALL");
    const record = await tx.caseAppeal.create({ data: { tenantId: ctx.tenantId, caseId: id, requestedById: ctx.actorId, grounds, status: CaseAppealStatus.SUBMITTED } });
    await appendAudit(tx, ctx, { action: "employee-case.appeal-submitted", resourceType: "CaseAppeal", resourceId: record.id, classification: DataClassification.HIGHLY_RESTRICTED });
    return record;
  }).catch((error) => error instanceof Error && error.message === "CASE_WALL" ? null : Promise.reject(error));

  if (!data) return forbidden("Case wall denies access to this matter.");
  return Response.json({ data }, { status: 201 });
}
