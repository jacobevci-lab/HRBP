import { DataClassification, LearningAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { enqueueLearningAssignmentNotification } from "@/lib/learning-notifications";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parsedDate(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.learningAssignment.findMany({
    where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
    orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
    include: { course: { select: { code: true, title: true, mandatory: true } } },
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();
  const body = await request.json() as { employmentId?: string; courseId?: string; dueAt?: string | null };
  if (!body.employmentId || !body.courseId) return Response.json({ error: "employmentId and courseId are required." }, { status: 400 });
  const dueAt = parsedDate(body.dueAt);
  if (dueAt === undefined) return Response.json({ error: "dueAt must be a valid date or blank." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, body.employmentId!)) throw new Error("OUT_OF_SCOPE");
      const [employment, course] = await Promise.all([
        tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        tx.learningCourse.findFirst({ where: { id: body.courseId, tenantId: ctx.tenantId, active: true }, select: { id: true, code: true, title: true } })
      ]);
      if (!employment || !course) throw new Error("NOT_FOUND");
      const assignment = await tx.learningAssignment.create({ data: { tenantId: ctx.tenantId, employmentId: body.employmentId!, courseId: body.courseId!, dueAt, status: LearningAssignmentStatus.ASSIGNED } });
      await appendAudit(tx, ctx, { action: "learning-assignment.created", resourceType: "LearningAssignment", resourceId: assignment.id, classification: DataClassification.CONFIDENTIAL });
      await enqueueLearningAssignmentNotification(tx, {
        tenantId: ctx.tenantId,
        employmentId: body.employmentId!,
        assignmentId: assignment.id,
        courseCode: course.code,
        courseTitle: course.title,
        dueAt
      });
      return assignment;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Employment or course not found in tenant." }, { status: 404 });
    throw error;
  }
}
