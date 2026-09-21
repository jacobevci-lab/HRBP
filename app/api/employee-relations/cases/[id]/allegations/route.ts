import { AllegationStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getCaseWallCase } from "@/lib/case-wall";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:read")) return forbidden();
  const { id } = await params;
  if (!await getCaseWallCase(ctx, id)) return forbidden("Case wall denies access to this matter.");
  const data = await db.caseAllegation.findMany({ where: { tenantId: ctx.tenantId, caseId: id }, orderBy: { raisedAt: "asc" } });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:write")) return forbidden();
  const { id } = await params;
  if (!await getCaseWallCase(ctx, id)) return forbidden("Case wall denies access to this matter.");
  const body = await request.json() as { category?: string; description?: string; severity?: string; policyCode?: string };
  if (!body.category?.trim() || !body.description?.trim()) return Response.json({ error: "category and description are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const allegation = await tx.caseAllegation.create({ data: { tenantId: ctx.tenantId, caseId: id, category: body.category!.trim(), description: body.description!.trim(), severity: body.severity, policyCode: body.policyCode, status: AllegationStatus.OPEN } });
    await appendAudit(tx, ctx, { action: "employee-case.allegation-added", resourceType: "CaseAllegation", resourceId: allegation.id, classification: DataClassification.HIGHLY_RESTRICTED });
    return allegation;
  });
  return Response.json({ data }, { status: 201 });
}
