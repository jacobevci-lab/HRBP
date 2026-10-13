import { asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
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
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid succession candidate id is required." }, { status: 400 });
  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const hasReadiness = Object.prototype.hasOwnProperty.call(body, "readiness");
  const hasRank = Object.prototype.hasOwnProperty.call(body, "rank");
  const hasGap = Object.prototype.hasOwnProperty.call(body, "developmentGap");
  const hasReason = Object.prototype.hasOwnProperty.call(body, "readinessReason");
  if (!hasReadiness && !hasRank && !hasGap) return Response.json({ error: "readiness, rank or developmentGap is required." }, { status: 400 });

  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "expectedUpdatedAt is required for concurrency-safe candidate updates." }, { status: 400 });
  }

  const readiness = hasReadiness ? String(body.readiness ?? "") as SuccessionReadiness : undefined;
  if (hasReadiness && !Object.values(SuccessionReadiness).includes(readiness!)) return Response.json({ error: "A valid readiness value is required." }, { status: 400 });
  const rank = hasRank ? parseRank(body.rank) : undefined;
  if (hasRank && rank === undefined) return Response.json({ error: "rank must be an integer from 1 to 99 or null." }, { status: 400 });
  const parsedGap = hasGap ? asOptionalText(body.developmentGap, 2000) : undefined;
  if (hasGap && parsedGap === null) return Response.json({ error: "developmentGap must not exceed 2000 characters." }, { status: 400 });
  const developmentGap = hasGap ? parsedGap ?? null : undefined;
  const readinessReason = hasReason ? asOptionalText(body.readinessReason, 2000) : undefined;
  if (hasReason && readinessReason === null) return Response.json({ error: "readinessReason must not exceed 2000 characters." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const candidate = await tx.successionCandidate.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          planId: true,
          employmentId: true,
          readiness: true,
          active: true,
          updatedAt: true,
          plan: { select: { positionId: true, active: true } }
        }
      });
      if (!candidate) throw new Error("NOT_FOUND");
      if (!candidate.active) throw new Error("CANDIDATE_INACTIVE");
      if (!candidate.plan.active) throw new Error("PLAN_INACTIVE");
      if (candidate.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STALE_STATE");
      const readinessChanged = Boolean(hasReadiness && readiness !== candidate.readiness);
      if (readinessChanged && (!readinessReason || readinessReason.length < 12)) throw new Error("READINESS_REASON_REQUIRED");
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
          where: { tenantId: ctx.tenantId, planId: candidate.planId, active: true, rank, id: { not: id } },
          select: { id: true }
        });
        if (collision) throw new Error("RANK_CONFLICT");
      }

      const result = await tx.successionCandidate.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          active: true,
          updatedAt: candidate.updatedAt
        },
        data: {
          ...(hasReadiness ? { readiness } : {}),
          ...(readinessChanged ? {
            readinessReason,
            readinessReviewedAt: new Date(),
            readinessReviewedById: ctx.actorId
          } : {}),
          ...(hasRank ? { rank } : {}),
          ...(hasGap ? { developmentGap } : {})
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.successionCandidate.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: readinessChanged ? "succession-candidate.readiness-reviewed" : "succession-candidate.updated",
        resourceType: "SuccessionCandidate",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: readinessChanged
          ? `Human readiness decision: previous=${candidate.readiness}; next=${readiness}; reasonRecorded=true`
          : undefined
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession candidate not found in tenant." }, { status: 404 });
    if (code === "CANDIDATE_INACTIVE") return Response.json({ error: "Removed succession candidates are read-only until explicitly reactivated." }, { status: 409 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Candidates on an inactive succession plan cannot be changed." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Candidate employment is outside your authorized relationship scope.");
    if (code === "PLAN_OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    if (code === "RANK_CONFLICT") return Response.json({ error: "That rank is already assigned to another candidate on this plan." }, { status: 409 });
    if (code === "READINESS_REASON_REQUIRED") return Response.json({ error: "Changing readiness requires a human decision reason of at least 12 characters." }, { status: 400 });
    if (code === "STALE_STATE") return Response.json({ error: "Succession candidate changed concurrently. Refresh before saving another readiness decision." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid succession candidate id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  const removalReason = asOptionalText(body.removalReason, 2000);
  if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "expectedUpdatedAt is required for concurrency-safe candidate removal." }, { status: 400 });
  }
  if (!removalReason || removalReason.length < 12) {
    return Response.json({ error: "Removing a succession candidate requires a reason of at least 12 characters." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const candidate = await tx.successionCandidate.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          active: true,
          updatedAt: true,
          plan: { select: { positionId: true, active: true } }
        }
      });
      if (!candidate) throw new Error("NOT_FOUND");
      if (!candidate.active) throw new Error("ALREADY_REMOVED");
      if (!candidate.plan.active) throw new Error("PLAN_INACTIVE");
      if (candidate.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STALE_STATE");

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

      const removedAt = new Date();
      const result = await tx.successionCandidate.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          active: true,
          updatedAt: candidate.updatedAt
        },
        data: {
          active: false,
          removedAt,
          removedById: ctx.actorId,
          removalReason,
          rank: null
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const removed = await tx.successionCandidate.findUnique({ where: { id } });
      if (!removed) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: "succession-candidate.removed",
        resourceType: "SuccessionCandidate",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Candidate removed from active succession pipeline; reasonRecorded=true; historyPreserved=true"
      });
      return removed;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession candidate not found in tenant." }, { status: 404 });
    if (code === "ALREADY_REMOVED") return Response.json({ error: "Succession candidate is already removed from the active plan." }, { status: 409 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Candidates on an inactive succession plan cannot be removed." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Candidate employment is outside your authorized relationship scope.");
    if (code === "PLAN_OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    if (code === "STALE_STATE") return Response.json({ error: "Succession candidate changed concurrently. Refresh before removing it." }, { status: 409 });
    throw error;
  }
}
