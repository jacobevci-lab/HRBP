import { DataClassification, EmploymentStatus, SuccessionReadiness } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseRank(value: unknown) {
  if (value === null || value === "") return null;
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 1 || rank > 99) return undefined;
  return rank;
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const planId = String(body.planId ?? "").trim();
  const employmentId = String(body.employmentId ?? "").trim();
  const readiness = String(body.readiness ?? "") as SuccessionReadiness;
  const rank = parseRank(body.rank);
  const developmentGap = body.developmentGap ? String(body.developmentGap).trim().slice(0, 2000) : null;
  if (!planId || !employmentId || !Object.values(SuccessionReadiness).includes(readiness)) return Response.json({ error: "planId, employmentId and valid readiness are required." }, { status: 400 });
  if (rank === undefined) return Response.json({ error: "rank must be an integer from 1 to 99 or blank." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
      const [plan, employment, existing] = await Promise.all([
        tx.successionPlan.findFirst({ where: { id: planId, tenantId: ctx.tenantId }, select: { id: true, positionId: true, active: true } }),
        tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } }),
        tx.successionCandidate.findUnique({ where: { planId_employmentId: { planId, employmentId } }, select: { id: true } })
      ]);
      if (!plan || !employment) throw new Error("NOT_FOUND");
      if (!plan.active) throw new Error("PLAN_INACTIVE");
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
        if (!scopedIncumbent) throw new Error("PLAN_OUT_OF_SCOPE");
      }
      if (rank !== null) {
        const collision = await tx.successionCandidate.findFirst({
          where: {
            tenantId: ctx.tenantId,
            planId,
            rank,
            ...(existing ? { id: { not: existing.id } } : {})
          },
          select: { id: true }
        });
        if (collision) throw new Error("RANK_CONFLICT");
      }

      const candidate = await tx.successionCandidate.upsert({
        where: { planId_employmentId: { planId, employmentId } },
        update: { readiness, rank, developmentGap },
        create: { tenantId: ctx.tenantId, planId, employmentId, readiness, rank, developmentGap }
      });
      await appendAudit(tx, ctx, { action: existing ? "succession-candidate.updated" : "succession-candidate.added", resourceType: "SuccessionCandidate", resourceId: candidate.id, classification: DataClassification.CONFIDENTIAL });
      return candidate;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "PLAN_OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Succession plan or employment not found in tenant." }, { status: 404 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Candidates cannot be added to an inactive succession plan." }, { status: 409 });
    if (code === "RANK_CONFLICT") return Response.json({ error: "That rank is already assigned to another candidate on this plan." }, { status: 409 });
    throw error;
  }
}
