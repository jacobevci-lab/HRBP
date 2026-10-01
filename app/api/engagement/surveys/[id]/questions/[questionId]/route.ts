import { DataClassification, Prisma, SurveyQuestionType } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const choiceTypes = new Set<SurveyQuestionType>([SurveyQuestionType.SINGLE_CHOICE, SurveyQuestionType.MULTI_CHOICE]);

function bounded(value: unknown, max: number) {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : text ? null : undefined;
}

function normalizedOptions(value: unknown, type: SurveyQuestionType | undefined) {
  if (value === undefined) return undefined;
  if (!type || !choiceTypes.has(type)) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) return null;
  const options = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (options.length !== value.length || options.some((item) => item.length > 120)) return null;
  return [...new Set(options)];
}

async function loadOwnedEditableQuestion(tx: Prisma.TransactionClient, ctx: NonNullable<ReturnType<typeof getRequestContext>>, surveyId: string, questionId: string) {
  const question = await tx.surveyQuestion.findFirst({
    where: { id: questionId, tenantId: ctx.tenantId, surveyId },
    select: {
      id: true, type: true,
      survey: {
        select: {
          createdById: true,
          campaigns: { where: { status: { not: "DRAFT" } }, take: 1, select: { id: true } }
        }
      }
    }
  });
  if (!question) throw new Error("NOT_FOUND");
  if (question.survey.createdById !== ctx.actorId) throw new Error("OWNER");
  if (question.survey.campaigns.length) throw new Error("LOCKED");
  return question;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; questionId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const { id, questionId } = await params;
  const body = await request.json() as Record<string, unknown>;
  const questionKey = bounded(body.questionKey, 80);
  const prompt = bounded(body.prompt, 1000);
  const dimension = bounded(body.dimension, 120);
  let type: SurveyQuestionType | undefined;
  if (body.type !== undefined) {
    const raw = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
    if (!Object.values(SurveyQuestionType).includes(raw as SurveyQuestionType)) return Response.json({ error: "A valid survey question type is required." }, { status: 400 });
    type = raw as SurveyQuestionType;
  }
  if (questionKey === null || prompt === null || dimension === null) return Response.json({ error: "Invalid survey question values." }, { status: 400 });
  if (questionKey && !/^[A-Z0-9_-]+$/i.test(questionKey)) return Response.json({ error: "questionKey may contain letters, numbers, underscore and dash only." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await loadOwnedEditableQuestion(tx, ctx, id, questionId);
    const effectiveType = type ?? current.type;
    const options = normalizedOptions(body.options, effectiveType);
    if (options === null) throw new Error("OPTIONS");

    const data: Prisma.SurveyQuestionUncheckedUpdateInput = {};
    if (questionKey !== undefined) data.questionKey = questionKey.toUpperCase();
    if (prompt !== undefined) data.prompt = prompt;
    if (type !== undefined) data.type = type;
    if (body.required !== undefined) data.required = body.required !== false;
    if (body.dimension !== undefined) data.dimension = dimension ?? null;
    if (body.options !== undefined) data.options = choiceTypes.has(effectiveType) ? options as Prisma.InputJsonValue : Prisma.DbNull;

    const updated = await tx.surveyQuestion.update({ where: { id: current.id }, data });
    await appendAudit(tx, ctx, {
      action: "engagement-survey-question.updated",
      resourceType: "SurveyQuestion",
      resourceId: current.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Governed engagement survey authoring"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "DUPLICATE" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "LOCKED", "OPTIONS"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Question not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the survey creator may edit its questions.");
  if (result === "LOCKED") return Response.json({ error: "Survey questions are locked after a campaign leaves DRAFT." }, { status: 409 });
  if (result === "OPTIONS") return Response.json({ error: "Choice questions require 2-20 unique bounded options." }, { status: 400 });
  if (result === "DUPLICATE") return Response.json({ error: "questionKey must be unique within the survey." }, { status: 409 });
  return Response.json({ data: result });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; questionId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();
  const { id, questionId } = await params;

  const result = await db.$transaction(async (tx) => {
    const current = await loadOwnedEditableQuestion(tx, ctx, id, questionId);
    const answers = await tx.surveyAnswer.count({ where: { tenantId: ctx.tenantId, questionId: current.id } });
    if (answers) throw new Error("ANSWERED");
    await tx.surveyQuestion.delete({ where: { id: current.id } });
    await appendAudit(tx, ctx, {
      action: "engagement-survey-question.deleted",
      resourceType: "SurveyQuestion",
      resourceId: current.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Governed engagement survey authoring"
    });
    return { id: current.id };
  }).catch((error) => {
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "LOCKED", "ANSWERED"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Question not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the survey creator may delete its questions.");
  if (result === "LOCKED") return Response.json({ error: "Survey questions are locked after a campaign leaves DRAFT." }, { status: 409 });
  if (result === "ANSWERED") return Response.json({ error: "Answered questions cannot be deleted." }, { status: 409 });
  return Response.json({ data: result });
}
