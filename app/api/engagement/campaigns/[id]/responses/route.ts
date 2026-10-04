import { readJsonObject } from "@/lib/input-validation";
import { createHmac } from "node:crypto";
import {
  DataClassification,
  EmploymentStatus,
  Prisma,
  SurveyQuestionType,
  SurveyStatus
} from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { runtimeString } from "@/lib/runtime-env";

const MAX_ANSWERS = 100;

type QuestionShape = {
  id: string;
  questionKey: string;
  prompt: string;
  type: SurveyQuestionType;
  required: boolean;
  orderIndex: number;
  options: Prisma.JsonValue;
  dimension: string | null;
};

function respondentToken(secret: string, tenantId: string, campaignId: string, employmentId: string) {
  return createHmac("sha256", secret)
    .update(`engagement-response:v1:${tenantId}:${campaignId}:${employmentId}`)
    .digest("hex");
}

function audienceEmploymentIds(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as string[];
  const raw = (value as { employmentIds?: unknown }).employmentIds;
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function questionOptions(question: QuestionShape) {
  return Array.isArray(question.options)
    ? question.options.filter((item): item is string => typeof item === "string")
    : [];
}

function validatedAnswer(question: QuestionShape, value: unknown): Prisma.InputJsonValue {
  if (question.type === SurveyQuestionType.SCALE) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) throw new Error("ANSWER");
    return value;
  }
  if (question.type === SurveyQuestionType.ENPS) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10) throw new Error("ANSWER");
    return value;
  }
  if (question.type === SurveyQuestionType.TEXT) {
    if (typeof value !== "string") throw new Error("ANSWER");
    const text = value.trim();
    if (!text || text.length > 2000) throw new Error("ANSWER");
    return text;
  }

  const options = questionOptions(question);
  if (question.type === SurveyQuestionType.SINGLE_CHOICE) {
    if (typeof value !== "string" || !options.includes(value)) throw new Error("ANSWER");
    return value;
  }

  if (question.type === SurveyQuestionType.MULTI_CHOICE) {
    if (!Array.isArray(value) || !value.length || value.length > Math.min(options.length, 20)) throw new Error("ANSWER");
    const selected = value.filter((item): item is string => typeof item === "string");
    if (selected.length !== value.length || new Set(selected).size !== selected.length || selected.some((item) => !options.includes(item))) throw new Error("ANSWER");
    return selected;
  }

  throw new Error("ANSWER");
}

async function loadCampaignForRespondent(
  ctx: NonNullable<Awaited<ReturnType<typeof getRequestContext>>>,
  campaignId: string
) {
  if (!ctx.employmentId) throw new Error("EMPLOYMENT");
  const secret = runtimeString("HRBP_ENGAGEMENT_RESPONSE_SECRET");
  if (!secret || secret.length < 32) throw new Error("SECRET");

  const [campaign, employment] = await Promise.all([
    db.surveyCampaign.findFirst({
      where: { id: campaignId, tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        anonymous: true,
        audienceFilter: true,
        opensAt: true,
        closesAt: true,
        survey: {
          select: {
            id: true,
            name: true,
            questions: {
              orderBy: { orderIndex: "asc" },
              take: MAX_ANSWERS,
              select: {
                id: true,
                questionKey: true,
                prompt: true,
                type: true,
                required: true,
                orderIndex: true,
                options: true,
                dimension: true
              }
            },
            _count: { select: { questions: true } }
          }
        }
      }
    }),
    db.employment.findFirst({
      where: {
        id: ctx.employmentId,
        tenantId: ctx.tenantId,
        status: { not: EmploymentStatus.TERMINATED }
      },
      select: { id: true }
    })
  ]);

  if (!campaign) throw new Error("NOT_FOUND");
  if (!employment) throw new Error("EMPLOYMENT");
  if (campaign.status !== SurveyStatus.OPEN) throw new Error("STATE");

  const now = new Date();
  if ((campaign.opensAt && campaign.opensAt > now) || (campaign.closesAt && campaign.closesAt <= now)) throw new Error("WINDOW");
  if (campaign.survey._count.questions > MAX_ANSWERS) throw new Error("TOO_LARGE");

  const audienceIds = audienceEmploymentIds(campaign.audienceFilter);
  if (audienceIds.length && !audienceIds.includes(employment.id)) throw new Error("AUDIENCE");

  return {
    campaign,
    employmentId: employment.id,
    token: respondentToken(secret, ctx.tenantId, campaign.id, employment.id)
  };
}

function campaignError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "NOT_FOUND") return Response.json({ error: "Campaign not found." }, { status: 404 });
  if (code === "EMPLOYMENT") return forbidden("An active employment context is required to respond.");
  if (code === "STATE") return Response.json({ error: "Campaign is not open for responses." }, { status: 409 });
  if (code === "WINDOW") return Response.json({ error: "Campaign is outside its response window." }, { status: 409 });
  if (code === "AUDIENCE") return forbidden("This campaign is outside your authorized response audience.");
  if (code === "TOO_LARGE") return Response.json({ error: "Survey exceeds the supported response question limit." }, { status: 409 });
  if (code === "SECRET") return Response.json({ error: "Engagement response token protection is not configured." }, { status: 503 });
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:read")) return forbidden();

  const { id } = await params;
  try {
    const loaded = await loadCampaignForRespondent(ctx, id);
    const existing = await db.surveyResponse.findFirst({
      where: { tenantId: ctx.tenantId, campaignId: loaded.campaign.id, respondentTokenHash: loaded.token },
      select: { id: true, submittedAt: true }
    });

    return Response.json({
      data: {
        campaignId: loaded.campaign.id,
        campaignName: loaded.campaign.name,
        surveyName: loaded.campaign.survey.name,
        anonymous: loaded.campaign.anonymous,
        submitted: Boolean(existing),
        submittedAt: existing?.submittedAt?.toISOString() ?? null,
        questions: existing ? [] : loaded.campaign.survey.questions.map((question) => ({
          id: question.id,
          questionKey: question.questionKey,
          prompt: question.prompt,
          type: question.type,
          required: question.required,
          orderIndex: question.orderIndex,
          options: questionOptions(question),
          dimension: question.dimension
        }))
      }
    });
  } catch (error) {
    return campaignError(error) ?? Response.json({ error: "Response context could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:read")) return forbidden();

  const { id } = await params;
  const body = await readJsonObject(request) as { answers?: unknown };
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  if (!Array.isArray(body.answers) || body.answers.length > MAX_ANSWERS) {
    return Response.json({ error: "answers must be a bounded array." }, { status: 400 });
  }

  try {
    const loaded = await loadCampaignForRespondent(ctx, id);
    const submitted = new Map<string, unknown>();
    for (const entry of body.answers) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("ANSWER");
      const questionId = typeof (entry as { questionId?: unknown }).questionId === "string"
        ? (entry as { questionId: string }).questionId.trim()
        : "";
      if (!questionId || submitted.has(questionId)) throw new Error("ANSWER");
      submitted.set(questionId, (entry as { value?: unknown }).value);
    }

    const questions = loaded.campaign.survey.questions;
    const questionById = new Map(questions.map((question) => [question.id, question]));
    if ([...submitted.keys()].some((questionId) => !questionById.has(questionId))) throw new Error("ANSWER");
    if (questions.some((question) => question.required && !submitted.has(question.id))) throw new Error("REQUIRED");

    const answers = [...submitted.entries()].map(([questionId, value]) => {
      const question = questionById.get(questionId);
      if (!question) throw new Error("ANSWER");
      return { questionId, value: validatedAnswer(question, value) };
    });

    const result = await db.$transaction(async (tx) => {
      const response = await tx.surveyResponse.create({
        data: {
          tenantId: ctx.tenantId,
          campaignId: loaded.campaign.id,
          respondentTokenHash: loaded.token,
          employmentId: loaded.campaign.anonymous ? null : loaded.employmentId
        }
      });

      if (answers.length) {
        await tx.surveyAnswer.createMany({
          data: answers.map((answer) => ({
            tenantId: ctx.tenantId,
            responseId: response.id,
            questionId: answer.questionId,
            value: answer.value
          }))
        });
      }

      if (!loaded.campaign.anonymous) {
        await appendAudit(tx, ctx, {
          action: "engagement-response.submitted",
          resourceType: "SurveyResponse",
          resourceId: response.id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: "Confidential engagement response submission"
        });
      }

      return { submittedAt: response.submittedAt };
    });

    return Response.json({ data: { submitted: true, submittedAt: result.submittedAt.toISOString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A response has already been submitted for this campaign." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "ANSWER") return Response.json({ error: "One or more answers are invalid for their question type." }, { status: 400 });
    if (error instanceof Error && error.message === "REQUIRED") return Response.json({ error: "All required survey questions must be answered." }, { status: 400 });
    return campaignError(error) ?? Response.json({ error: "Survey response could not be submitted." }, { status: 500 });
  }
}
