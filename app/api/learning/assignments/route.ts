import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { DataClassification, EmploymentStatus, LearningAssignmentStatus, Prisma } from "@prisma/client";
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

const openStatuses = [
  LearningAssignmentStatus.ASSIGNED,
  LearningAssignmentStatus.IN_PROGRESS,
  LearningAssignmentStatus.OVERDUE
];

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.learningAssignment.findMany({
    where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
    orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
    include: { course: { select: { code: true, title: true, mandatory: true } } },
    take: 300
  });
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const employmentId = asIdentifier(body.employmentId);
  const courseId = asIdentifier(body.courseId);
  if (!employmentId || !courseId) {
    return Response.json({ error: "employmentId and courseId are required." }, { status: 400 });
  }

  const dueAt = parsedDate(body.dueAt);
  if (dueAt === undefined) return Response.json({ error: "dueAt must be a valid date or blank." }, { status: 400 });
  if (dueAt) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (dueAt < today) return Response.json({ error: "dueAt cannot be in the past." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");

      const [employment, course, existingOpenAssignment] = await Promise.all([
        tx.employment.findFirst({
          where: { id: employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
          select: { id: true }
        }),
        tx.learningCourse.findFirst({
          where: { id: courseId, tenantId: ctx.tenantId, active: true },
          select: { id: true, code: true, title: true }
        }),
        tx.learningAssignment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            employmentId,
            courseId,
            status: { in: openStatuses }
          },
          select: { id: true }
        })
      ]);

      if (!employment || !course) throw new Error("NOT_FOUND");
      if (existingOpenAssignment) throw new Error("DUPLICATE_OPEN_ASSIGNMENT");

      const assignment = await tx.learningAssignment.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId,
          courseId,
          dueAt,
          status: LearningAssignmentStatus.ASSIGNED
        }
      });
      await appendAudit(tx, ctx, {
        action: "learning-assignment.created",
        resourceType: "LearningAssignment",
        resourceId: assignment.id,
        classification: DataClassification.CONFIDENTIAL
      });
      await enqueueLearningAssignmentNotification(tx, {
        tenantId: ctx.tenantId,
        employmentId,
        assignmentId: assignment.id,
        courseCode: course.code,
        courseTitle: course.title,
        dueAt
      });
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const prismaCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Employment or course not found in tenant." }, { status: 404 });
    if (code === "DUPLICATE_OPEN_ASSIGNMENT" || prismaCode === "P2034" || prismaCode === "P2002") {
      return Response.json({ error: "An open learning assignment already exists for this employee and course. Complete, waive or update it before creating another." }, { status: 409 });
    }
    throw error;
  }
}
