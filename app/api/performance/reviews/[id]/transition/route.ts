import { DataClassification, PerformanceBand, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<ReviewStatus, ReviewStatus[]> = {
  NOT_STARTED: [ReviewStatus.SELF_REVIEW],
  SELF_REVIEW: [],
  MANAGER_REVIEW: [],
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
        select: {
          id: true,
          employmentId: true,
          status: true,
          managerRating: true,
          finalRating: true,
          cycle: { select: { status: true } }
        }
      });
      if (!review) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, review.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!(transitions[review.status] ?? []).includes(next)) throw new Error("INVALID_TRANSITION");
      if (next === ReviewStatus.SELF_REVIEW && review.cycle.status !== ReviewCycleStatus.OPEN) throw new Error("CYCLE_PHASE");
      if (next === ReviewStatus.FINALIZED && review.cycle.status !== ReviewCycleStatus.CALIBRATION) throw new Error("CYCLE_PHASE");

      const finalRating = next === ReviewStatus.FINALIZED ? (rating(body.finalRating) ?? review.finalRating ?? undefined) : undefined;
      if (next === ReviewStatus.FINALIZED && !review.managerRating) throw new Error("MANAGER_RATING_REQUIRED");
      if (next === ReviewStatus.FINALIZED && !finalRating) throw new Error("FINAL_RATING_REQUIRED");

      const updated = await tx.performanceReview.update({
        where: { id },
        data: {
          status: next,
          finalRating,
          calibrationNotes: next === ReviewStatus.FINALIZED && body.calibrationNotes ? String(body.calibrationNotes).trim().slice(0, 4000) : undefined
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
    if (code === "INVALID_TRANSITION") return Response.json({ error: "Review transition is not allowed from the current state. Employee and manager phases must be submitted by their assigned identities." }, { status: 409 });
    if (code === "CYCLE_PHASE") return Response.json({ error: "Review transition is not allowed in the current review-cycle phase." }, { status: 409 });
    if (code === "MANAGER_RATING_REQUIRED") return Response.json({ error: "A manager-submitted rating is required before calibration can be finalized." }, { status: 400 });
    if (code === "FINAL_RATING_REQUIRED") return Response.json({ error: "A human-entered final rating is required before finalization." }, { status: 400 });
    throw error;
  }
}
