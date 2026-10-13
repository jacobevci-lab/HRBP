import { asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, EmploymentStatus, PositionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function initialReviewDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const max = now + 730 * 24 * 60 * 60 * 1000;
  if (date.getTime() <= now || date.getTime() > max) return null;
  return date;
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
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
    take: 200,
    include: { candidates: { where: { active: true, ...employmentIdFilter(scope) }, orderBy: [{ rank: "asc" }, { addedAt: "asc" }] } }
  });
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });

  const positionId = asIdentifier(body.positionId);
  const name = asOptionalText(body.name, 180);
  const reviewDueAt = initialReviewDate(body.reviewDueAt);
  if (!positionId) return Response.json({ error: "A valid positionId is required." }, { status: 400 });
  if (name === null) return Response.json({ error: "name must not exceed 180 characters." }, { status: 400 });
  if (!reviewDueAt) return Response.json({ error: "reviewDueAt must be a future date within 730 days." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      const position = await tx.position.findFirst({
        where: { id: positionId, tenantId: ctx.tenantId, validTo: null, status: { not: PositionStatus.CLOSED } },
        select: { id: true }
      });
      if (!position) throw new Error("NOT_FOUND");

      if (scope !== null) {
        const scopedIncumbent = await tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId,
            status: { not: EmploymentStatus.TERMINATED },
            ...employmentPrimaryKeyFilter(scope)
          },
          select: { id: true }
        });
        if (!scopedIncumbent) throw new Error("OUT_OF_SCOPE");
      }

      const existing = await tx.successionPlan.findUnique({
        where: { tenantId_positionId: { tenantId: ctx.tenantId, positionId } },
        select: { id: true }
      });
      if (existing) throw new Error("PLAN_EXISTS");

      const plan = await tx.successionPlan.create({
        data: {
          tenantId: ctx.tenantId,
          positionId,
          name: name ?? null,
          ownerId: ctx.actorId,
          active: true,
          reviewDueAt
        }
      });

      await appendAudit(tx, ctx, {
        action: "succession-plan.created",
        resourceType: "SuccessionPlan",
        resourceId: plan.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Human-owned succession plan created; nextReview=${reviewDueAt.toISOString()}`
      });
      return plan;
    });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const prismaCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Position has no incumbent inside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Position not found in tenant." }, { status: 404 });
    if (code === "PLAN_EXISTS" || prismaCode === "P2002") {
      return Response.json({ error: "A succession plan already exists for this position. Use the governed plan maintenance and review workflow instead of recreating or silently reactivating it." }, { status: 409 });
    }
    throw error;
  }
}
