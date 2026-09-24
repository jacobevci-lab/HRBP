import { DataClassification, LearningAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<LearningAssignmentStatus, LearningAssignmentStatus[]> = {
  ASSIGNED: [LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.WAIVED, LearningAssignmentStatus.OVERDUE],
  IN_PROGRESS: [LearningAssignmentStatus.COMPLETED, LearningAssignmentStatus.WAIVED, LearningAssignmentStatus.OVERDUE],
  COMPLETED: [],
  OVERDUE: [LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.COMPLETED, LearningAssignmentStatus.WAIVED],
  WAIVED: []
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const next = String(body.status ?? "") as LearningAssignmentStatus;
  if (!Object.values(LearningAssignmentStatus).includes(next)) return Response.json({ error: "A valid learning assignment status is required." }, { status: 400 });
  const score = body.score === undefined || body.score === "" ? undefined : Number(body.score);
  if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100)) return Response.json({ error: "score must be between 0 and 100." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const assignment = await tx.learningAssignment.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, status: true, completedAt: true }
      });
      if (!assignment) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, assignment.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!(transitions[assignment.status] ?? []).includes(next)) throw new Error("INVALID_TRANSITION");

      const updated = await tx.learningAssignment.update({
        where: { id },
        data: {
          status: next,
          completedAt: next === LearningAssignmentStatus.COMPLETED ? new Date() : assignment.completedAt,
          score: next === LearningAssignmentStatus.COMPLETED ? score : undefined,
          certificateReference: next === LearningAssignmentStatus.COMPLETED && body.certificateReference ? String(body.certificateReference).trim().slice(0, 500) : undefined
        }
      });
      await appendAudit(tx, ctx, {
        action: `learning-assignment.transition.${assignment.status.toLowerCase()}.${next.toLowerCase()}`,
        resourceType: "LearningAssignment",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Learning assignment not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "Learning assignment transition is not allowed from the current state." }, { status: 409 });
    throw error;
  }
}
