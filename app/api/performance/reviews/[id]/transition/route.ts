import { DataClassification, PerformanceBand, ReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<ReviewStatus, ReviewStatus[]> = {
  NOT_STARTED: [ReviewStatus.SELF_REVIEW],
  SELF_REVIEW: [ReviewStatus.MANAGER_REVIEW],
  MANAGER_REVIEW: [ReviewStatus.CALIBRATION],
  CALIBRATION: [ReviewStatus.FINALIZED],
  FINALIZED: []
};

function rating(value: unknown): PerformanceBand | undefined {
  if (!value) return undefined;
  const candidate = String(value) as PerformanceBand;
  return Object.values(PerformanceBand).includes(candidate) ? candidate : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const next = String(body.status ?? "") as ReviewStatus;
  if (!Object.values(ReviewStatus).includes(next)) return Response.json({ error: "A valid review status is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const review = await tx.performanceReview.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, status: true, selfRating: true, managerRating: true, finalRating: true }
      });
      if (!review) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, review.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!(transitions[review.status] ?? []).includes(next)) throw new Error("INVALID_TRANSITION");

      const selfRating = rating(body.selfRating) ?? review.selfRating ?? undefined;
      const managerRating = rating(body.managerRating) ?? review.managerRating ?? undefined;
      const finalRating = rating(body.finalRating) ?? review.finalRating ?? undefined;
      if (next === ReviewStatus.MANAGER_REVIEW && !selfRating) throw new Error("SELF_RATING_REQUIRED");
      if (next === ReviewStatus.CALIBRATION && !managerRating) throw new Error("MANAGER_RATING_REQUIRED");
      if (next === ReviewStatus.FINALIZED && !finalRating) throw new Error("FINAL_RATING_REQUIRED");

      const updated = await tx.performanceReview.update({
        where: { id },
        data: {
          status: next,
          selfRating,
          managerRating,
          finalRating,
          summary: body.summary ? String(body.summary).trim().slice(0, 4000) : undefined,
          calibrationNotes: body.calibrationNotes ? String(body.calibrationNotes).trim().slice(0, 4000) : undefined
        }
      });
      await appendAudit(tx, ctx, {
        action: `performance-review.transition.${review.status.toLowerCase()}.${next.toLowerCase()}`,
        resourceType: "PerformanceReview",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Performance review not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "Review transition is not allowed from the current state." }, { status: 409 });
    if (code === "SELF_RATING_REQUIRED") return Response.json({ error: "A human-entered self rating is required before manager review." }, { status: 400 });
    if (code === "MANAGER_RATING_REQUIRED") return Response.json({ error: "A human-entered manager rating is required before calibration." }, { status: 400 });
    if (code === "FINAL_RATING_REQUIRED") return Response.json({ error: "A human-entered final rating is required before finalization." }, { status: 400 });
    throw error;
  }
}
