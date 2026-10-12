import { DataClassification, EmploymentStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function nextReviewDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const max = now + 730 * 24 * 60 * 60 * 1000;
  if (date.getTime() <= now || date.getTime() > max) return null;
  return date;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid succession plan id is required." }, { status: 400 });

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const summary = asText(body.summary, 2000);
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  const reviewDueAt = nextReviewDate(body.nextReviewDueAt);

  if (!summary || summary.length < 12) {
    return Response.json({ error: "Succession review summary must contain at least 12 characters." }, { status: 400 });
  }
  if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "expectedUpdatedAt is required for concurrency-safe review attestation." }, { status: 400 });
  }
  if (!reviewDueAt) {
    return Response.json({ error: "nextReviewDueAt must be a future date within 730 days." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const plan = await tx.successionPlan.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          positionId: true,
          active: true,
          updatedAt: true,
          _count: { select: { candidates: true } }
        }
      });
      if (!plan) throw new Error("NOT_FOUND");
      if (!plan.active) throw new Error("PLAN_INACTIVE");
      if (plan.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STALE_STATE");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (scope !== null) {
        const scopedIncumbent = await tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId: plan.positionId,
            status: { not: EmploymentStatus.TERMINATED },
            ...employmentPrimaryKeyFilter(scope)
          },
          select: { id: true }
        });
        if (!scopedIncumbent) throw new Error("OUT_OF_SCOPE");
      }

      const reviewedAt = new Date();
      const result = await tx.successionPlan.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          active: true,
          updatedAt: plan.updatedAt
        },
        data: {
          lastReviewedAt: reviewedAt,
          lastReviewedById: ctx.actorId,
          lastReviewSummary: summary,
          reviewDueAt
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");

      await appendAudit(tx, ctx, {
        action: "succession-plan.review-attested",
        resourceType: "SuccessionPlan",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Human succession review attested; candidates=${plan._count.candidates}; nextReview=${reviewDueAt.toISOString()}; summaryRecorded=true`
      });

      const updated = await tx.successionPlan.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");
      return updated;
    });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession plan not found in tenant." }, { status: 404 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Inactive succession plans cannot be reviewed. Reactivate the plan first." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    if (code === "STALE_STATE") return Response.json({ error: "Succession plan changed concurrently. Refresh before attesting the review." }, { status: 409 });
    throw error;
  }
}
