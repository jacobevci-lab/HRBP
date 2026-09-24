import { DataClassification, EmploymentStatus, SuccessionReadiness } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseRank(value: unknown) {
  if (value === null || value === "") return null;
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 1 || rank > 99) return undefined;
  return rank;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasReadiness = Object.prototype.hasOwnProperty.call(body, "readiness");
  const hasRank = Object.prototype.hasOwnProperty.call(body, "rank");
  const hasGap = Object.prototype.hasOwnProperty.call(body, "developmentGap");
  if (!hasReadiness && !hasRank && !hasGap) return Response.json({ error: "readiness, rank or developmentGap is required." }, { status: 400 });

  const readiness = hasReadiness ? String(body.readiness ?? "") as SuccessionReadiness : undefined;
  if (hasReadiness && !Object.values(SuccessionReadiness).includes(readiness!)) return Response.json({ error: "A valid readiness value is required." }, { status: 400 });
  const rank = hasRank ? parseRank(body.rank) : undefined;
  if (hasRank && rank === undefined) return Response.json({ error: "rank must be an integer from 1 to 99 or null." }, { status: 400 });
  const developmentGap = hasGap ? String(body.developmentGap ?? "").trim().slice(0, 2000) || null : undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const candidate = await tx.successionCandidate.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          planId: true,
          employmentId: true,
          plan: { select: { positionId: true, active: true } }
        }
      });
      if (!candidate) throw new Error("NOT_FOUND");
      if (!candidate.plan.active) throw new Error("PLAN_INACTIVE");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, candidate.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (scope !== null) {
        const scopedIncumbent = await tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId: candidate.plan.positionId,
            status: { not: EmploymentStatus.TERMINATED },
            ...employmentPrimaryKeyFilter(scope)
          },
          select: { id: true }
        });
        if (!scopedIncumbent) throw new Error("PLAN_OUT_OF_SCOPE");
      }
      if (rank !== undefined && rank !== null) {
        const collision = await tx.successionCandidate.findFirst({
          where: { tenantId: ctx.tenantId, planId: candidate.planId, rank, id: { not: id } },
          select: { id: true }
        });
        if (collision) throw new Error("RANK_CONFLICT");
      }

      const updated = await tx.successionCandidate.update({
        where: { id },
        data: {
          ...(hasReadiness ? { readiness } : {}),
          ...(hasRank ? { rank } : {}),
          ...(hasGap ? { developmentGap } : {})
        }
      });
      await appendAudit(tx, ctx, {
        action: "succession-candidate.updated",
        resourceType: "SuccessionCandidate",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession candidate not found in tenant." }, { status: 404 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Candidates on an inactive succession plan cannot be changed." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Candidate employment is outside your authorized relationship scope.");
    if (code === "PLAN_OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    if (code === "RANK_CONFLICT") return Response.json({ error: "That rank is already assigned to another candidate on this plan." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();
  const { id } = await params;

  try {
    const data = await db.$transaction(async (tx) => {
      const candidate = await tx.successionCandidate.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, plan: { select: { positionId: true, active: true } } }
      });
      if (!candidate) throw new Error("NOT_FOUND");
      if (!candidate.plan.active) throw new Error("PLAN_INACTIVE");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, candidate.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (scope !== null) {
        const scopedIncumbent = await tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId: candidate.plan.positionId,
            status: { not: EmploymentStatus.TERMINATED },
            ...employmentPrimaryKeyFilter(scope)
          },
          select: { id: true }
        });
        if (!scopedIncumbent) throw new Error("PLAN_OUT_OF_SCOPE");
      }

      const removed = await tx.successionCandidate.delete({ where: { id } });
      await appendAudit(tx, ctx, {
        action: "succession-candidate.removed",
        resourceType: "SuccessionCandidate",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return removed;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession candidate not found in tenant." }, { status: 404 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Candidates on an inactive succession plan cannot be removed." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Candidate employment is outside your authorized relationship scope.");
    if (code === "PLAN_OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    throw error;
  }
}
