import { DataClassification, EmploymentStatus, Prisma, PrismaClient, SurveyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import { getEngagementLiveData } from "@/lib/governance-planning-live-data";
import { getRequestContext, mutationOriginAllowed, unauthorized, type RequestContext } from "@/lib/request-context";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

async function normalizedAudience(client: PrismaClient | Prisma.TransactionClient, ctx: RequestContext, raw: unknown): Promise<Prisma.InputJsonValue> {
  const scope = await resolveEmploymentScope(client, ctx);
  const source = raw && typeof raw === "object" ? raw as { employmentIds?: unknown; orgUnitIds?: unknown; positionIds?: unknown } : {};
  const employmentIds = asStringArray(source.employmentIds);
  const orgUnitIds = asStringArray(source.orgUnitIds);
  const positionIds = asStringArray(source.positionIds);
  const hasSelectors = employmentIds.length > 0 || orgUnitIds.length > 0 || positionIds.length > 0;

  if (!hasSelectors) {
    if (scope === null) {
      const active = await client.employment.findMany({
        where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
        select: { id: true }
      });
      if (!active.length) throw new Error("EMPTY_AUDIENCE");
      const canonicalIds = active.map((employment) => employment.id);
      return { employmentIds: canonicalIds, targetCount: canonicalIds.length };
    }
    if (!scope.length) throw new Error("EMPTY_SCOPE");
    return { employmentIds: scope, targetCount: scope.length };
  }

  const selectorOr = [
    ...(employmentIds.length ? [{ id: { in: employmentIds } }] : []),
    ...(orgUnitIds.length ? [{ position: { is: { orgUnitId: { in: orgUnitIds } } } }] : []),
    ...(positionIds.length ? [{ positionId: { in: positionIds } }] : [])
  ];
  const matched = await client.employment.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { not: EmploymentStatus.TERMINATED },
      OR: selectorOr
    },
    select: { id: true }
  });

  if (scope !== null) {
    if (!scope.length) throw new Error("EMPTY_SCOPE");
    const scoped = new Set(scope);
    if (matched.some((employment) => !scoped.has(employment.id))) throw new Error("OUT_OF_SCOPE");
  }

  const canonicalIds = [...new Set(matched.map((employment) => employment.id))];
  if (!canonicalIds.length) throw new Error("EMPTY_AUDIENCE");
  return { employmentIds: canonicalIds, targetCount: canonicalIds.length };
}

function audienceTargetCount(audience: Prisma.InputJsonValue) {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return null;
  const value = (audience as { targetCount?: unknown }).targetCount;
  return typeof value === "number" ? value : null;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:read")) return forbidden();
  const live = await getEngagementLiveData(ctx);
  return Response.json({
    data: live.rows,
    summary: {
      activeCampaigns: live.activeCampaigns,
      visibleResponses: live.responses,
      suppressedCampaigns: live.suppressedCampaigns,
      anonymousCampaigns: live.anonymousCampaigns,
      relationshipScoped: live.relationshipScoped
    }
  });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();
  const body = await request.json() as { surveyId?: string; name?: string; anonymous?: boolean; anonymityThreshold?: number; opensAt?: string; closesAt?: string; audienceFilter?: unknown };
  const surveyId = body.surveyId?.trim();
  const name = body.name?.trim();
  if (!surveyId || !name || surveyId.length > 128 || name.length > 160) return Response.json({ error: "Valid surveyId and name are required." }, { status: 400 });
  const threshold = body.anonymityThreshold ?? 7;
  if (!Number.isInteger(threshold) || threshold < 5 || threshold > 1000) return Response.json({ error: "anonymityThreshold must be an integer between 5 and 1000." }, { status: 400 });
  const opensAt = body.opensAt ? new Date(body.opensAt) : undefined;
  const closesAt = body.closesAt ? new Date(body.closesAt) : undefined;
  if ((opensAt && Number.isNaN(opensAt.getTime())) || (closesAt && Number.isNaN(closesAt.getTime()))) return Response.json({ error: "Campaign dates must be valid." }, { status: 400 });
  if (opensAt && closesAt && closesAt <= opensAt) return Response.json({ error: "closesAt must be later than opensAt." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const survey = await tx.engagementSurvey.findFirst({ where: { id: surveyId, tenantId: ctx.tenantId }, select: { id: true, _count: { select: { questions: true } } } });
    if (!survey) throw new Error("NOT_FOUND");
    if (!survey._count.questions) throw new Error("EMPTY_SURVEY");
    const audienceFilter = await normalizedAudience(tx, ctx, body.audienceFilter);
    const campaign = await tx.surveyCampaign.create({ data: { tenantId: ctx.tenantId, surveyId: survey.id, name, anonymous: body.anonymous ?? true, anonymityThreshold: threshold, status: SurveyStatus.DRAFT, opensAt, closesAt, audienceFilter, createdById: ctx.actorId } });
    const targetCount = audienceTargetCount(audienceFilter);
    await appendAudit(tx, ctx, { action: "engagement-campaign.created", resourceType: "SurveyCampaign", resourceId: campaign.id, classification: DataClassification.CONFIDENTIAL, purpose: targetCount === null ? "Governed engagement campaign creation" : `Governed engagement campaign creation; audience=${targetCount}` });
    return campaign;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "EMPTY_SURVEY", "EMPTY_SCOPE", "OUT_OF_SCOPE", "EMPTY_AUDIENCE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "NOT_FOUND") return Response.json({ error: "Survey not found in tenant." }, { status: 404 });
  if (data === "EMPTY_SURVEY") return Response.json({ error: "Add at least one survey question before creating a campaign." }, { status: 409 });
  if (data === "EMPTY_SCOPE") return forbidden("No authorized employment population is available for this campaign.");
  if (data === "OUT_OF_SCOPE") return forbidden("Campaign audience cannot include employments outside your authorized relationship scope.");
  if (data === "EMPTY_AUDIENCE") return Response.json({ error: "Campaign audience resolves to no active employments." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
