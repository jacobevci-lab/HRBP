import { DataClassification, LearningAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const data = await db.learningAssignment.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }], include: { course: { select: { code: true, title: true, mandatory: true } } }, take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:write")) return forbidden();
  const body = await request.json() as { employmentId?: string; courseId?: string; dueAt?: string };
  if (!body.employmentId || !body.courseId) return Response.json({ error: "employmentId and courseId are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const [employment, course] = await Promise.all([
      tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.learningCourse.findFirst({ where: { id: body.courseId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
    ]);
    if (!employment || !course) throw new Error("NOT_FOUND");
    const assignment = await tx.learningAssignment.create({ data: { tenantId: ctx.tenantId, employmentId: body.employmentId!, courseId: body.courseId!, dueAt: body.dueAt ? new Date(body.dueAt) : undefined, status: LearningAssignmentStatus.ASSIGNED } });
    await appendAudit(tx, ctx, { action: "learning-assignment.created", resourceType: "LearningAssignment", resourceId: assignment.id, classification: DataClassification.CONFIDENTIAL });
    return assignment;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Employment or course not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
