import { asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, SkillProficiency } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.skill.findMany({
    where: { tenantId: ctx.tenantId, active: true },
    orderBy: [{ critical: "desc" }, { name: "asc" }],
    include: { _count: { select: { employments: { where: { ...employmentIdFilter(scope) } } } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });

  const employeeAssessmentRequested = ["employmentId", "skillId", "proficiency"].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key)
  );

  if (employeeAssessmentRequested) {
    const employmentId = asIdentifier(body.employmentId);
    const skillId = asIdentifier(body.skillId);
    const proficiency = String(body.proficiency ?? "") as SkillProficiency;
    const source = asOptionalText(body.source, 500);

    if (!employmentId || !skillId || !Object.values(SkillProficiency).includes(proficiency)) {
      return Response.json({ error: "employmentId, skillId and valid proficiency are required." }, { status: 400 });
    }
    if (source === null) {
      return Response.json({ error: "source must not exceed 500 characters." }, { status: 400 });
    }

    try {
      const data = await db.$transaction(async (tx) => {
        const scope = await resolveEmploymentScope(tx, ctx);
        if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");

        const [employment, skill, existing] = await Promise.all([
          tx.employment.findFirst({
            where: { id: employmentId, tenantId: ctx.tenantId },
            select: { id: true }
          }),
          tx.skill.findFirst({
            where: { id: skillId, tenantId: ctx.tenantId, active: true },
            select: { id: true }
          }),
          tx.employmentSkill.findUnique({
            where: { employmentId_skillId: { employmentId, skillId } },
            select: { id: true }
          })
        ]);
        if (!employment || !skill) throw new Error("NOT_FOUND");
        if (existing) throw new Error("ASSESSMENT_EXISTS");

        const record = await tx.employmentSkill.create({
          data: {
            tenantId: ctx.tenantId,
            employmentId,
            skillId,
            proficiency,
            source: source ?? null,
            assessedById: ctx.actorId
          }
        });

        await appendAudit(tx, ctx, {
          action: "employee-skill.assessed",
          resourceType: "EmploymentSkill",
          resourceId: record.id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: `Initial human proficiency assessment; proficiency=${proficiency}; sourceRecorded=${Boolean(source)}`
        });
        return record;
      });
      return Response.json({ data }, { status: 201 });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const prismaCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
      if (code === "NOT_FOUND") return Response.json({ error: "Employment or active skill not found in tenant." }, { status: 404 });
      if (code === "ASSESSMENT_EXISTS" || prismaCode === "P2002") {
        return Response.json({ error: "A proficiency assessment already exists for this employee and skill. Use the governed reassessment workflow instead of overwriting the original decision." }, { status: 409 });
      }
      throw error;
    }
  }

  const code = String(body.code ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();
  if (!code || !name) return Response.json({ error: "code and name are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const skill = await tx.skill.create({
      data: {
        tenantId: ctx.tenantId,
        code,
        name,
        category: body.category ? String(body.category) : undefined,
        critical: Boolean(body.critical)
      }
    });
    await appendAudit(tx, ctx, {
      action: "skill.created",
      resourceType: "Skill",
      resourceId: skill.id,
      classification: DataClassification.INTERNAL
    });
    return skill;
  });
  return Response.json({ data }, { status: 201 });
}
