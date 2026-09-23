import { DataClassification, InvestigationFinding } from "@prisma/client";
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
  const data = await db.caseFinding.findMany({ where: { tenantId: ctx.tenantId, caseId: id }, orderBy: { decidedAt: "desc" } });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { allegationId?: string; finding?: InvestigationFinding; rationale?: string };
  if (!body.finding || !Object.values(InvestigationFinding).includes(body.finding) || !body.rationale?.trim()) return Response.json({ error: "valid finding and rationale are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    if (!await getCaseWallCase(ctx, id, tx)) throw new Error("CASE_WALL");
    if (body.allegationId) {
      const allegation = await tx.caseAllegation.findFirst({ where: { id: body.allegationId, tenantId: ctx.tenantId, caseId: id }, select: { id: true } });
      if (!allegation) throw new Error("ALLEGATION");
    }
    const record = await tx.caseFinding.create({
      data: {
        tenantId: ctx.tenantId,
        caseId: id,
        allegationId: body.allegationId,
        finding: body.finding!,
        rationale: body.rationale!.trim(),
        decidedById: ctx.actorId
      }
    });
    await appendAudit(tx, ctx, { action: "employee-case.finding-recorded", resourceType: "CaseFinding", resourceId: record.id, classification: DataClassification.HIGHLY_RESTRICTED });
    return record;
  }).catch((error) => error instanceof Error && ["CASE_WALL", "ALLEGATION"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
  if (data === "ALLEGATION") return Response.json({ error: "allegationId must belong to this case and tenant." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
