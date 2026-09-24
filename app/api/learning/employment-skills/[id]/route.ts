import { DataClassification, SkillProficiency } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasProficiency = Object.prototype.hasOwnProperty.call(body, "proficiency");
  const hasSource = Object.prototype.hasOwnProperty.call(body, "source");
  if (!hasProficiency && !hasSource) return Response.json({ error: "proficiency or source is required." }, { status: 400 });
  const proficiency = hasProficiency ? String(body.proficiency ?? "") as SkillProficiency : undefined;
  if (hasProficiency && !Object.values(SkillProficiency).includes(proficiency!)) return Response.json({ error: "A valid proficiency is required." }, { status: 400 });
  const source = hasSource ? String(body.source ?? "").trim().slice(0, 500) || null : undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const record = await tx.employmentSkill.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true }
      });
      if (!record) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, record.employmentId)) throw new Error("OUT_OF_SCOPE");

      const updated = await tx.employmentSkill.update({
        where: { id },
        data: {
          ...(hasProficiency ? { proficiency } : {}),
          ...(hasSource ? { source } : {}),
          assessedAt: new Date()
        }
      });
      await appendAudit(tx, ctx, {
        action: "employee-skill.reassessed",
        resourceType: "EmploymentSkill",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Employee skill assessment not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    throw error;
  }
}
