import { DataClassification, EmploymentStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parsedDate(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasReviewDueAt = Object.prototype.hasOwnProperty.call(body, "reviewDueAt");
  const hasActive = typeof body.active === "boolean";
  if (!hasName && !hasReviewDueAt && !hasActive) return Response.json({ error: "name, reviewDueAt or active is required." }, { status: 400 });

  const name = hasName ? String(body.name ?? "").trim().slice(0, 180) || null : undefined;
  const reviewDueAt = hasReviewDueAt ? parsedDate(body.reviewDueAt) : undefined;
  if (hasReviewDueAt && reviewDueAt === undefined) return Response.json({ error: "reviewDueAt must be a valid date or null." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const plan = await tx.successionPlan.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, positionId: true, active: true }
      });
      if (!plan) throw new Error("NOT_FOUND");

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

      const updated = await tx.successionPlan.update({
        where: { id },
        data: {
          ...(hasName ? { name } : {}),
          ...(hasReviewDueAt ? { reviewDueAt } : {}),
          ...(hasActive ? { active: Boolean(body.active) } : {})
        }
      });
      const action = hasActive && Boolean(body.active) !== plan.active
        ? Boolean(body.active) ? "succession-plan.reactivated" : "succession-plan.deactivated"
        : "succession-plan.updated";
      await appendAudit(tx, ctx, {
        action,
        resourceType: "SuccessionPlan",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession plan not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    throw error;
  }
}
