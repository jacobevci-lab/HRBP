import { DataClassification, ReviewCycleStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "performance:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.reviewCycle.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { endsAt: "desc" },
    include: { _count: { select: { reviews: { where: { ...employmentIdFilter(scope) } } } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:write")) return forbidden();
  const body = await request.json() as { name?: string; startsAt?: string; endsAt?: string; calibrationAt?: string };
  if (!body.name || !body.startsAt || !body.endsAt) return Response.json({ error: "name, startsAt and endsAt are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const cycle = await tx.reviewCycle.create({ data: { tenantId: ctx.tenantId, name: body.name!, startsAt: new Date(body.startsAt!), endsAt: new Date(body.endsAt!), calibrationAt: body.calibrationAt ? new Date(body.calibrationAt) : undefined, status: ReviewCycleStatus.DRAFT } });
    await appendAudit(tx, ctx, { action: "review-cycle.created", resourceType: "ReviewCycle", resourceId: cycle.id, classification: DataClassification.CONFIDENTIAL });
    return cycle;
  });
  return Response.json({ data }, { status: 201 });
}
