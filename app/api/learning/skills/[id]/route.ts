import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasCategory = Object.prototype.hasOwnProperty.call(body, "category");
  const hasCritical = Object.prototype.hasOwnProperty.call(body, "critical");
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  if (!hasName && !hasCategory && !hasCritical && !hasActive) return Response.json({ error: "A skill field is required." }, { status: 400 });

  const name = hasName ? String(body.name ?? "").trim().slice(0, 250) : undefined;
  if (hasName && !name) return Response.json({ error: "name cannot be blank." }, { status: 400 });
  const category = hasCategory ? String(body.category ?? "").trim().slice(0, 250) || null : undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const skill = await tx.skill.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, active: true } });
      if (!skill) throw new Error("NOT_FOUND");
      const updated = await tx.skill.update({
        where: { id },
        data: {
          ...(hasName ? { name } : {}),
          ...(hasCategory ? { category } : {}),
          ...(hasCritical ? { critical: Boolean(body.critical) } : {}),
          ...(hasActive ? { active: Boolean(body.active) } : {})
        }
      });
      await appendAudit(tx, ctx, {
        action: skill.active !== updated.active ? updated.active ? "skill.reactivated" : "skill.deactivated" : "skill.updated",
        resourceType: "Skill",
        resourceId: id,
        classification: DataClassification.INTERNAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return Response.json({ error: "Skill not found in tenant." }, { status: 404 });
    throw error;
  }
}
