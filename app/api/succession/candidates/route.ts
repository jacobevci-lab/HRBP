import { DataClassification, SuccessionReadiness } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const planId = String(body.planId ?? "");
  const employmentId = String(body.employmentId ?? "");
  const readiness = String(body.readiness ?? "") as SuccessionReadiness;
  if (!planId || !employmentId || !Object.values(SuccessionReadiness).includes(readiness)) return Response.json({ error: "planId, employmentId and valid readiness are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
    const [plan, employment] = await Promise.all([
      tx.successionPlan.findFirst({ where: { id: planId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } })
    ]);
    if (!plan || !employment) throw new Error("NOT_FOUND");
    const candidate = await tx.successionCandidate.upsert({
      where: { planId_employmentId: { planId, employmentId } },
      update: { readiness, rank: body.rank ? Number(body.rank) : undefined, developmentGap: body.developmentGap ? String(body.developmentGap) : undefined },
      create: { tenantId: ctx.tenantId, planId, employmentId, readiness, rank: body.rank ? Number(body.rank) : undefined, developmentGap: body.developmentGap ? String(body.developmentGap) : undefined }
    });
    await appendAudit(tx, ctx, { action: "succession-candidate.saved", resourceType: "SuccessionCandidate", resourceId: candidate.id, classification: DataClassification.CONFIDENTIAL });
    return candidate;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  if (data === "NOT_FOUND") return Response.json({ error: "Succession plan or employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
