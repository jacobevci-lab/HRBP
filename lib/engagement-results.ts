import { EmploymentStatus, Prisma, SurveyQuestionType } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

const MAX_RESULT_RESPONSES = 5000;

function stringArray(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as string[];
  const raw = (value as { employmentIds?: unknown }).employmentIds;
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function numeric(value: Prisma.JsonValue) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: Prisma.JsonValue) {
  return typeof value === "string" ? value : null;
}

function stringValues(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function getEngagementCampaignResults(ctx: RequestContext, campaignId: string) {
  if (!can(ctx, "engagement:write")) throw new Error("FORBIDDEN");

  const campaign = await db.surveyCampaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
    select: {
      id: true,
      name: true,
      anonymous: true,
      anonymityThreshold: true,
      audienceFilter: true,
      status: true,
      survey: {
        select: {
          id: true,
          name: true,
          questions: {
            orderBy: { orderIndex: "asc" },
            take: 100,
            select: {
              id: true,
              questionKey: true,
              prompt: true,
              type: true,
              orderIndex: true,
              options: true,
              dimension: true
            }
          },
          _count: { select: { questions: true } }
        }
      }
    }
  });
  if (!campaign) throw new Error("NOT_FOUND");
  if (!["OPEN", "CLOSED", "ARCHIVED"].includes(campaign.status)) throw new Error("STATE");
  if (campaign.survey._count.questions > 100) throw new Error("TOO_LARGE");

  const scope = await resolveEmploymentScope(db, ctx);
  const canonicalAudience = stringArray(campaign.audienceFilter);

  if (campaign.anonymous && scope !== null) {
    if (!canonicalAudience.length) {
      return {
        campaign: { id: campaign.id, name: campaign.name, survey: campaign.survey.name, anonymous: true, status: campaign.status },
        suppressed: true,
        suppressionReason: "Anonymous campaign results require full authorized audience coverage.",
        threshold: campaign.anonymityThreshold,
        responseCount: 0,
        targetCount: null,
        responseRate: null,
        questions: []
      };
    }
    const allowed = new Set(scope);
    if (canonicalAudience.some((employmentId) => !allowed.has(employmentId))) {
      return {
        campaign: { id: campaign.id, name: campaign.name, survey: campaign.survey.name, anonymous: true, status: campaign.status },
        suppressed: true,
        suppressionReason: "Anonymous campaign results are suppressed because the audience extends beyond your relationship scope.",
        threshold: campaign.anonymityThreshold,
        responseCount: 0,
        targetCount: null,
        responseRate: null,
        questions: []
      };
    }
  }

  const responseWhere: Prisma.SurveyResponseWhereInput = {
    tenantId: ctx.tenantId,
    campaignId: campaign.id,
    ...(campaign.anonymous || scope === null ? {} : { employmentId: { in: scope } })
  };

  const responseCount = await db.surveyResponse.count({ where: responseWhere });
  if (responseCount > MAX_RESULT_RESPONSES) throw new Error("RESULT_SET_TOO_LARGE");

  let targetCount: number | null;
  if (campaign.anonymous) {
    if (canonicalAudience.length) targetCount = canonicalAudience.length;
    else targetCount = await db.employment.count({ where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } } });
  } else if (scope === null) {
    targetCount = canonicalAudience.length
      ? canonicalAudience.length
      : await db.employment.count({ where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } } });
  } else {
    const scopedActive = scope.length ? await db.employment.count({
      where: { tenantId: ctx.tenantId, id: { in: scope }, status: { not: EmploymentStatus.TERMINATED } }
    }) : 0;
    targetCount = canonicalAudience.length
      ? canonicalAudience.filter((employmentId) => scope.includes(employmentId)).length
      : scopedActive;
  }

  const threshold = Math.max(5, campaign.anonymityThreshold);
  if (responseCount < threshold) {
    return {
      campaign: { id: campaign.id, name: campaign.name, survey: campaign.survey.name, anonymous: campaign.anonymous, status: campaign.status },
      suppressed: true,
      suppressionReason: `Results require at least ${threshold} responses in the authorized cohort.`,
      threshold,
      responseCount,
      targetCount,
      responseRate: targetCount ? round((responseCount / targetCount) * 100) : null,
      questions: []
    };
  }

  const responses = await db.surveyResponse.findMany({
    where: responseWhere,
    orderBy: { submittedAt: "asc" },
    take: MAX_RESULT_RESPONSES,
    select: { id: true }
  });
  const responseIds = responses.map((response) => response.id);
  const aggregatableQuestions = campaign.survey.questions.filter((question) => question.type !== SurveyQuestionType.TEXT);
  const questionIds = aggregatableQuestions.map((question) => question.id);
  const answers = responseIds.length && questionIds.length ? await db.surveyAnswer.findMany({
    where: {
      tenantId: ctx.tenantId,
      responseId: { in: responseIds },
      questionId: { in: questionIds }
    },
    select: { questionId: true, value: true }
  }) : [];

  const questions = campaign.survey.questions.map((question) => {
    if (question.type === SurveyQuestionType.TEXT) {
      return {
        id: question.id,
        questionKey: question.questionKey,
        prompt: question.prompt,
        type: question.type,
        dimension: question.dimension,
        answered: 0,
        suppressed: true,
        suppressionReason: "Free-text responses are never displayed in aggregate engagement results.",
        metric: null,
        distribution: []
      };
    }

    const values = answers.filter((answer) => answer.questionId === question.id).map((answer) => answer.value);
    if (values.length < threshold) {
      return {
        id: question.id,
        questionKey: question.questionKey,
        prompt: question.prompt,
        type: question.type,
        dimension: question.dimension,
        answered: values.length,
        suppressed: true,
        suppressionReason: `Question result requires at least ${threshold} answers.`,
        metric: null,
        distribution: []
      };
    }

    if (question.type === SurveyQuestionType.SCALE) {
      const numbers = values.map(numeric).filter((value): value is number => value !== null);
      return {
        id: question.id,
        questionKey: question.questionKey,
        prompt: question.prompt,
        type: question.type,
        dimension: question.dimension,
        answered: numbers.length,
        suppressed: numbers.length < threshold,
        suppressionReason: numbers.length < threshold ? `Question result requires at least ${threshold} numeric answers.` : null,
        metric: numbers.length >= threshold ? { label: "Average", value: round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 2) } : null,
        distribution: []
      };
    }

    if (question.type === SurveyQuestionType.ENPS) {
      const numbers = values.map(numeric).filter((value): value is number => value !== null);
      if (numbers.length < threshold) {
        return {
          id: question.id, questionKey: question.questionKey, prompt: question.prompt, type: question.type, dimension: question.dimension,
          answered: numbers.length, suppressed: true, suppressionReason: `Question result requires at least ${threshold} numeric answers.`, metric: null, distribution: []
        };
      }
      const promoters = numbers.filter((value) => value >= 9).length;
      const detractors = numbers.filter((value) => value <= 6).length;
      const score = round(((promoters - detractors) / numbers.length) * 100);
      return {
        id: question.id,
        questionKey: question.questionKey,
        prompt: question.prompt,
        type: question.type,
        dimension: question.dimension,
        answered: numbers.length,
        suppressed: false,
        suppressionReason: null,
        metric: { label: "eNPS", value: score },
        distribution: []
      };
    }

    const configuredOptions = Array.isArray(question.options)
      ? question.options.filter((item): item is string => typeof item === "string")
      : [];
    const counts = new Map(configuredOptions.map((option) => [option, 0]));
    for (const value of values) {
      const selected = question.type === SurveyQuestionType.SINGLE_CHOICE
        ? (stringValue(value) ? [stringValue(value)!] : [])
        : stringValues(value);
      for (const option of selected) if (counts.has(option)) counts.set(option, (counts.get(option) ?? 0) + 1);
    }
    const lowVolumeBucket = [...counts.values()].some((count) => count > 0 && count < threshold);
    if (lowVolumeBucket) {
      return {
        id: question.id,
        questionKey: question.questionKey,
        prompt: question.prompt,
        type: question.type,
        dimension: question.dimension,
        answered: 0,
        suppressed: true,
        suppressionReason: `Choice distribution is suppressed because one or more non-empty options are below the privacy threshold of ${threshold}.`,
        metric: null,
        distribution: []
      };
    }

    const distribution = [...counts.entries()].map(([option, count]) => ({
      option,
      count,
      percent: round((count / values.length) * 100),
      suppressed: false
    }));

    return {
      id: question.id,
      questionKey: question.questionKey,
      prompt: question.prompt,
      type: question.type,
      dimension: question.dimension,
      answered: values.length,
      suppressed: false,
      suppressionReason: null,
      metric: null,
      distribution
    };
  });

  return {
    campaign: { id: campaign.id, name: campaign.name, survey: campaign.survey.name, anonymous: campaign.anonymous, status: campaign.status },
    suppressed: false,
    suppressionReason: null,
    threshold,
    responseCount,
    targetCount,
    responseRate: targetCount ? round((responseCount / targetCount) * 100) : null,
    questions
  };
}
