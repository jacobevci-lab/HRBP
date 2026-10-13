import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid skill id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasCategory = Object.prototype.hasOwnProperty.call(body, "category");
  const hasCritical = Object.prototype.hasOwnProperty.call(body, "critical");
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  if (!hasName && !hasCategory && !hasCritical && !hasActive) {
    return Response.json({ error: "A skill field is required." }, { status: 400 });
  }

  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "expectedUpdatedAt is required for concurrency-safe skill updates." }, { status: 400 });
  }
  const name = hasName ? asText(body.name, 180) : undefined;
  const category = hasCategory ? asOptionalText(body.category, 120) : undefined;
  if (hasName && !name) return Response.json({ error: "name must be 1–180 characters of text." }, { status: 400 });
  if (hasCategory && category === null) return Response.json({ error: "category must not exceed 120 characters." }, { status: 400 });
  if (hasCritical && typeof body.critical !== "boolean") {
    return Response.json({ error: "critical must be a boolean." }, { status: 400 });
  }
  if (hasActive && typeof body.active !== "boolean") {
    return Response.json({ error: "active must be a boolean." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const skill = await tx.skill.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, active: true, updatedAt: true }
      });
      if (!skill) throw new Error("NOT_FOUND");
      if (skill.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STALE_STATE");

      const changed = await tx.skill.updateMany({
        where: { id, tenantId: ctx.tenantId, updatedAt: skill.updatedAt },
        data: {
          ...(hasName ? { name: name! } : {}),
          ...(hasCategory ? { category: category ?? null } : {}),
          ...(hasCritical ? { critical: body.critical as boolean } : {}),
          ...(hasActive ? { active: body.active as boolean } : {})
        }
      });
      if (changed.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.skill.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: skill.active !== updated.active
          ? updated.active ? "skill.reactivated" : "skill.deactivated"
          : "skill.updated",
        resourceType: "Skill",
        resourceId: id,
        classification: DataClassification.INTERNAL
      });
      return updated;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Skill not found in tenant." }, { status: 404 });
    if (code === "STALE_STATE") return Response.json({ error: "Skill changed concurrently. Refresh before saving another catalog decision." }, { status: 409 });
    throw error;
  }
}
