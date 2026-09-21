import { DataClassification, SkillProficiency } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const data = await db.skill.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: [{ critical: "desc" }, { name: "asc" }], include: { _count: { select: { employments: true } } } });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const employmentId = String(body.employmentId ?? "");
  const skillId = String(body.skillId ?? "");
  const proficiency = String(body.proficiency ?? "") as SkillProficiency;

  if (employmentId || skillId) {
    if (!employmentId || !skillId || !Object.values(SkillProficiency).includes(proficiency)) return Response.json({ error: "employmentId, skillId and valid proficiency are required." }, { status: 400 });
    const data = await db.$transaction(async (tx) => {
      const [employment, skill] = await Promise.all([
        tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        tx.skill.findFirst({ where: { id: skillId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
      ]);
      if (!employment || !skill) throw new Error("NOT_FOUND");
      const record = await tx.employmentSkill.upsert({
        where: { employmentId_skillId: { employmentId, skillId } },
        update: { proficiency, source: body.source ? String(body.source) : undefined, assessedAt: new Date() },
        create: { tenantId: ctx.tenantId, employmentId, skillId, proficiency, source: body.source ? String(body.source) : undefined }
      });
      await appendAudit(tx, ctx, { action: "employee-skill.saved", resourceType: "EmploymentSkill", resourceId: record.id, classification: DataClassification.CONFIDENTIAL });
      return record;
    }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
    if (!data) return Response.json({ error: "Employment or skill not found in tenant." }, { status: 404 });
    return Response.json({ data }, { status: 201 });
  }

  const code = String(body.code ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();
  if (!code || !name) return Response.json({ error: "code and name are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const skill = await tx.skill.create({ data: { tenantId: ctx.tenantId, code, name, category: body.category ? String(body.category) : undefined, critical: Boolean(body.critical) } });
    await appendAudit(tx, ctx, { action: "skill.created", resourceType: "Skill", resourceId: skill.id, classification: DataClassification.INTERNAL });
    return skill;
  });
  return Response.json({ data }, { status: 201 });
}
