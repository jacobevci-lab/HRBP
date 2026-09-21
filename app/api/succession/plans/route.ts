import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "succession:read")) return forbidden();
  const data = await db.successionPlan.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: "desc" }, { reviewDueAt: "asc" }], include: { candidates: { orderBy: [{ rank: "asc" }, { addedAt: "asc" }] } } });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "succession:write")) return forbidden();
  const body = await request.json() as { positionId?: string; name?: string; ownerId?: string; reviewDueAt?: string };
  if (!body.positionId) return Response.json({ error: "positionId is required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const position = await tx.position.findFirst({ where: { id: body.positionId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!position) throw new Error("NOT_FOUND");
    const plan = await tx.successionPlan.upsert({
      where: { tenantId_positionId: { tenantId: ctx.tenantId, positionId: body.positionId! } },
      update: { active: true, name: body.name, ownerId: body.ownerId, reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : undefined },
      create: { tenantId: ctx.tenantId, positionId: body.positionId!, name: body.name, ownerId: body.ownerId, reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : undefined }
    });
    await appendAudit(tx, ctx, { action: "succession-plan.saved", resourceType: "SuccessionPlan", resourceId: plan.id, classification: DataClassification.CONFIDENTIAL });
    return plan;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Position not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
