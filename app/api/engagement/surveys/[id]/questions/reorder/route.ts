import { readJsonObject } from "@/lib/input-validation";
import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const MAX_QUESTIONS = 100;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const { id } = await params;
  const body = await readJsonObject(request) as { questionIds?: unknown };
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  if (!Array.isArray(body.questionIds) || !body.questionIds.length || body.questionIds.length > MAX_QUESTIONS) {
    return Response.json({ error: "questionIds must be a non-empty bounded array." }, { status: 400 });
  }
  const questionIds = body.questionIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
  if (questionIds.length !== body.questionIds.length || new Set(questionIds).size !== questionIds.length) {
    return Response.json({ error: "questionIds must contain unique valid ids." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const survey = await tx.engagementSurvey.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: {
        id: true,
        createdById: true,
        campaigns: { where: { status: { not: "DRAFT" } }, take: 1, select: { id: true } },
        questions: { select: { id: true } }
      }
    });
    if (!survey) throw new Error("NOT_FOUND");
    if (survey.createdById !== ctx.actorId) throw new Error("OWNER");
    if (survey.campaigns.length) throw new Error("LOCKED");
    if (survey.questions.length !== questionIds.length) throw new Error("MISMATCH");

    const existingIds = new Set(survey.questions.map((question) => question.id));
    if (questionIds.some((questionId) => !existingIds.has(questionId))) throw new Error("MISMATCH");

    for (let index = 0; index < questionIds.length; index += 1) {
      await tx.surveyQuestion.update({
        where: { id: questionIds[index] },
        data: { orderIndex: index + 1 }
      });
    }

    await appendAudit(tx, ctx, {
      action: "engagement-survey-question.reordered",
      resourceType: "EngagementSurvey",
      resourceId: survey.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: `Reordered ${questionIds.length} survey questions`
    });
    return { questionIds };
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "LOCKED", "MISMATCH"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Survey not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the survey creator may reorder its questions.");
  if (result === "LOCKED") return Response.json({ error: "Survey questions are locked after a campaign leaves DRAFT." }, { status: 409 });
  if (result === "MISMATCH") return Response.json({ error: "questionIds must exactly match the survey's current questions." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Question order changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
