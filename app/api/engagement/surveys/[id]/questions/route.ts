import { DataClassification, Prisma, SurveyQuestionType } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const choiceTypes = new Set<SurveyQuestionType>([SurveyQuestionType.SINGLE_CHOICE, SurveyQuestionType.MULTI_CHOICE]);

function bounded(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

function normalizedOptions(value: unknown, type: SurveyQuestionType) {
  if (!choiceTypes.has(type)) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) return null;
  const options = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (options.length !== value.length || options.some((item) => item.length > 120)) return null;
  return [...new Set(options)];
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const questionKeyValue = bounded(body.questionKey, 80, true);
  const prompt = bounded(body.prompt, 1000, true);
  const dimension = bounded(body.dimension, 120);
  const typeValue = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
  if (!Object.values(SurveyQuestionType).includes(typeValue as SurveyQuestionType)) {
    return Response.json({ error: "A valid survey question type is required." }, { status: 400 });
  }
  const type = typeValue as SurveyQuestionType;
  const options = normalizedOptions(body.options, type);

  if (!questionKeyValue || !prompt || dimension === null || options === null) {
    return Response.json({ error: "Invalid survey question values." }, { status: 400 });
  }
  if (!/^[A-Z0-9_-]+$/i.test(questionKeyValue)) return Response.json({ error: "questionKey may contain letters, numbers, underscore and dash only." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const survey = await tx.engagementSurvey.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, createdById: true, campaigns: { where: { status: { not: "DRAFT" } }, take: 1, select: { id: true } } }
    });
    if (!survey) throw new Error("NOT_FOUND");
    if (survey.createdById !== ctx.actorId) throw new Error("OWNER");
    if (survey.campaigns.length) throw new Error("LOCKED");

    const maxOrder = await tx.surveyQuestion.aggregate({
      where: { tenantId: ctx.tenantId, surveyId: survey.id },
      _max: { orderIndex: true }
    });
    const question = await tx.surveyQuestion.create({
      data: {
        tenantId: ctx.tenantId,
        surveyId: survey.id,
        questionKey: questionKeyValue.toUpperCase(),
        prompt,
        type,
        required: body.required !== false,
        orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
        options: options as Prisma.InputJsonValue | undefined,
        dimension
      }
    });
    await appendAudit(tx, ctx, {
      action: "engagement-survey-question.created",
      resourceType: "SurveyQuestion",
      resourceId: question.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Governed engagement survey authoring"
    });
    return question;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "DUPLICATE" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "LOCKED"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Survey not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the survey creator may author its questions.");
  if (result === "LOCKED") return Response.json({ error: "Survey questions are locked after a campaign leaves DRAFT." }, { status: 409 });
  if (result === "DUPLICATE") return Response.json({ error: "questionKey must be unique within the survey." }, { status: 409 });
  return Response.json({ data: result }, { status: 201 });
}
