import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.learningCourse.findMany({
    where: { tenantId: ctx.tenantId, active: true },
    orderBy: [{ mandatory: "desc" }, { title: "asc" }],
    include: { _count: { select: { assignments: { where: { ...employmentIdFilter(scope) } } } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const code = String(body.code ?? "").trim().toUpperCase();
  const title = String(body.title ?? "").trim();
  if (!code || !title) return Response.json({ error: "code and title are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const course = await tx.learningCourse.create({ data: { tenantId: ctx.tenantId, code, title, provider: body.provider ? String(body.provider) : undefined, mandatory: Boolean(body.mandatory), validityMonths: body.validityMonths ? Number(body.validityMonths) : undefined } });
    await appendAudit(tx, ctx, { action: "learning-course.created", resourceType: "LearningCourse", resourceId: course.id, classification: DataClassification.INTERNAL });
    return course;
  });
  return Response.json({ data }, { status: 201 });
}
