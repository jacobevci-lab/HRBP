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
  if (scope === null) return (raw && typeof raw === "object" ? raw : {}) as Prisma.InputJsonValue;
  if (!scope.length) throw new Error("EMPTY_SCOPE");

  const source = raw && typeof raw === "object" ? raw as { employmentIds?: unknown; orgUnitIds?: unknown; positionIds?: unknown } : {};
  const employmentIds = asStringArray(source.employmentIds);
  const orgUnitIds = asStringArray(source.orgUnitIds);
  const positionIds = asStringArray(source.positionIds);
  const hasSelectors = employmentIds.length > 0 || orgUnitIds.length > 0 || positionIds.length > 0;
  if (!hasSelectors) return { employmentIds: scope, targetCount: scope.length };

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
  const scoped = new Set(scope);
  if (matched.some((employment) => !scoped.has(employment.id))) throw new Error("OUT_OF_SCOPE");
  const canonicalIds = [...new Set(matched.map((employment) => employment.id))];
  if (!canonicalIds.length) throw new Error("EMPTY_AUDIENCE");
  return { employmentIds: canonicalIds, targetCount: canonicalIds.length };
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
  const name = body.name?.trim();
  if (!body.surveyId || !name) return Response.json({ error: "surveyId and name are required." }, { status: 400 });
  const threshold = Math.max(5, body.anonymityThreshold ?? 7);
  const data = await db.$transaction(async (tx) => {
    const survey = await tx.engagementSurvey.findFirst({ where: { id: body.surveyId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!survey) throw new Error("NOT_FOUND");
    const audienceFilter = await normalizedAudience(tx, ctx, body.audienceFilter);
    const campaign = await tx.surveyCampaign.create({ data: { tenantId: ctx.tenantId, surveyId: survey.id, name, anonymous: body.anonymous ?? true, anonymityThreshold: threshold, status: SurveyStatus.DRAFT, opensAt: body.opensAt ? new Date(body.opensAt) : undefined, closesAt: body.closesAt ? new Date(body.closesAt) : undefined, audienceFilter, createdById: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "engagement-campaign.created", resourceType: "SurveyCampaign", resourceId: campaign.id, classification: DataClassification.CONFIDENTIAL, metadata: { audienceTargetCount: (audienceFilter as { targetCount?: number }).targetCount ?? null } });
    return campaign;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "EMPTY_SCOPE", "OUT_OF_SCOPE", "EMPTY_AUDIENCE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "NOT_FOUND") return Response.json({ error: "Survey not found in tenant." }, { status: 404 });
  if (data === "EMPTY_SCOPE") return forbidden("No authorized employment population is available for this campaign.");
  if (data === "OUT_OF_SCOPE") return forbidden("Campaign audience cannot include employments outside your authorized relationship scope.");
  if (data === "EMPTY_AUDIENCE") return Response.json({ error: "Campaign audience resolves to no active employments." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
