import { DataClassification, EmploymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parsedDate(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "succession:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const scopedPositionIds = scope === null ? null : [...new Set((await db.employment.findMany({
    where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED }, ...employmentPrimaryKeyFilter(scope), positionId: { not: null } },
    select: { positionId: true }
  })).flatMap((employment) => employment.positionId ? [employment.positionId] : []))];
  const data = await db.successionPlan.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(scope === null ? {} : { positionId: { in: scopedPositionIds ?? [] } })
    },
    orderBy: [{ active: "desc" }, { reviewDueAt: "asc" }],
    include: { candidates: { where: { ...employmentIdFilter(scope) }, orderBy: [{ rank: "asc" }, { addedAt: "asc" }] } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();
  const body = await request.json() as { positionId?: string; name?: string; reviewDueAt?: string | null };
  if (!body.positionId) return Response.json({ error: "positionId is required." }, { status: 400 });
  const reviewDueAt = parsedDate(body.reviewDueAt);
  if (reviewDueAt === undefined) return Response.json({ error: "reviewDueAt must be a valid date or blank." }, { status: 400 });
  const name = body.name?.trim().slice(0, 180) || undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      const position = await tx.position.findFirst({ where: { id: body.positionId, tenantId: ctx.tenantId }, select: { id: true } });
      if (!position) throw new Error("NOT_FOUND");
      if (scope !== null) {
        const scopedIncumbent = await tx.employment.findFirst({
          where: { tenantId: ctx.tenantId, positionId: body.positionId, status: { not: EmploymentStatus.TERMINATED }, ...employmentPrimaryKeyFilter(scope) },
          select: { id: true }
        });
        if (!scopedIncumbent) throw new Error("OUT_OF_SCOPE");
      }
      const existing = await tx.successionPlan.findUnique({
        where: { tenantId_positionId: { tenantId: ctx.tenantId, positionId: body.positionId! } },
        select: { id: true }
      });
      const plan = await tx.successionPlan.upsert({
        where: { tenantId_positionId: { tenantId: ctx.tenantId, positionId: body.positionId! } },
        update: { active: true, name, reviewDueAt: reviewDueAt ?? undefined },
        create: { tenantId: ctx.tenantId, positionId: body.positionId!, name, ownerId: ctx.actorId, reviewDueAt }
      });
      await appendAudit(tx, ctx, { action: existing ? "succession-plan.reactivated-or-refreshed" : "succession-plan.created", resourceType: "SuccessionPlan", resourceId: plan.id, classification: DataClassification.CONFIDENTIAL });
      return plan;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Position has no incumbent inside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Position not found in tenant." }, { status: 404 });
    throw error;
  }
}
