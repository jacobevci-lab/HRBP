import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseValidity(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && !/^\d{1,3}$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) return undefined;
  return parsed;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid course id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasProvider = Object.prototype.hasOwnProperty.call(body, "provider");
  const hasMandatory = Object.prototype.hasOwnProperty.call(body, "mandatory");
  const hasValidity = Object.prototype.hasOwnProperty.call(body, "validityMonths");
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  if (!hasTitle && !hasProvider && !hasMandatory && !hasValidity && !hasActive) {
    return Response.json({ error: "A course field is required." }, { status: 400 });
  }

  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "expectedUpdatedAt is required for concurrency-safe course updates." }, { status: 400 });
  }
  const title = hasTitle ? asText(body.title, 250) : undefined;
  const provider = hasProvider ? asOptionalText(body.provider, 250) : undefined;
  const validityMonths = hasValidity ? parseValidity(body.validityMonths) : undefined;
  if (hasTitle && !title) return Response.json({ error: "title must be 1–250 characters of text." }, { status: 400 });
  if (hasProvider && provider === null) return Response.json({ error: "provider must not exceed 250 characters." }, { status: 400 });
  if (hasValidity && validityMonths === undefined) {
    return Response.json({ error: "validityMonths must be between 1 and 120 or blank." }, { status: 400 });
  }
  if (hasMandatory && typeof body.mandatory !== "boolean") {
    return Response.json({ error: "mandatory must be a boolean." }, { status: 400 });
  }
  if (hasActive && typeof body.active !== "boolean") {
    return Response.json({ error: "active must be a boolean." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const course = await tx.learningCourse.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, active: true, updatedAt: true }
      });
      if (!course) throw new Error("NOT_FOUND");
      if (course.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STALE_STATE");

      const changed = await tx.learningCourse.updateMany({
        where: { id, tenantId: ctx.tenantId, updatedAt: course.updatedAt },
        data: {
          ...(hasTitle ? { title } : {}),
          ...(hasProvider ? { provider: provider ?? null } : {}),
          ...(hasMandatory ? { mandatory: body.mandatory as boolean } : {}),
          ...(hasValidity ? { validityMonths } : {}),
          ...(hasActive ? { active: body.active as boolean } : {})
        }
      });
      if (changed.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.learningCourse.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: course.active !== updated.active
          ? updated.active ? "learning-course.reactivated" : "learning-course.deactivated"
          : "learning-course.updated",
        resourceType: "LearningCourse",
        resourceId: id,
        classification: DataClassification.INTERNAL
      });
      return updated;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Learning course not found in tenant." }, { status: 404 });
    if (code === "STALE_STATE") return Response.json({ error: "Course changed concurrently. Refresh before saving another catalog decision." }, { status: 409 });
    throw error;
  }
}
