import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseValidity(value: unknown) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) return undefined;
  return parsed;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasProvider = Object.prototype.hasOwnProperty.call(body, "provider");
  const hasMandatory = Object.prototype.hasOwnProperty.call(body, "mandatory");
  const hasValidity = Object.prototype.hasOwnProperty.call(body, "validityMonths");
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  if (!hasTitle && !hasProvider && !hasMandatory && !hasValidity && !hasActive) return Response.json({ error: "A course field is required." }, { status: 400 });

  const title = hasTitle ? String(body.title ?? "").trim().slice(0, 250) : undefined;
  if (hasTitle && !title) return Response.json({ error: "title cannot be blank." }, { status: 400 });
  const provider = hasProvider ? String(body.provider ?? "").trim().slice(0, 250) || null : undefined;
  const validityMonths = hasValidity ? parseValidity(body.validityMonths) : undefined;
  if (hasValidity && validityMonths === undefined) return Response.json({ error: "validityMonths must be between 1 and 120 or blank." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const course = await tx.learningCourse.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, active: true } });
      if (!course) throw new Error("NOT_FOUND");
      const updated = await tx.learningCourse.update({
        where: { id },
        data: {
          ...(hasTitle ? { title } : {}),
          ...(hasProvider ? { provider } : {}),
          ...(hasMandatory ? { mandatory: Boolean(body.mandatory) } : {}),
          ...(hasValidity ? { validityMonths } : {}),
          ...(hasActive ? { active: Boolean(body.active) } : {})
        }
      });
      await appendAudit(tx, ctx, {
        action: course.active !== updated.active ? updated.active ? "learning-course.reactivated" : "learning-course.deactivated" : "learning-course.updated",
        resourceType: "LearningCourse",
        resourceId: id,
        classification: DataClassification.INTERNAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return Response.json({ error: "Learning course not found in tenant." }, { status: 404 });
    throw error;
  }
}
