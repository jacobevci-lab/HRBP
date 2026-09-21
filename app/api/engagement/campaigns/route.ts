import { DataClassification, SurveyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:read")) return forbidden();
  const data = await db.surveyCampaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, include: { survey: { select: { code: true, name: true } }, _count: { select: { responses: true } } }, take: 200 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:write")) return forbidden();
  const body = await request.json() as { surveyId?: string; name?: string; anonymous?: boolean; anonymityThreshold?: number; opensAt?: string; closesAt?: string; audienceFilter?: unknown };
  const name = body.name?.trim();
  if (!body.surveyId || !name) return Response.json({ error: "surveyId and name are required." }, { status: 400 });
  const threshold = Math.max(5, body.anonymityThreshold ?? 7);
  const data = await db.$transaction(async (tx) => {
    const survey = await tx.engagementSurvey.findFirst({ where: { id: body.surveyId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!survey) throw new Error("NOT_FOUND");
    const campaign = await tx.surveyCampaign.create({ data: { tenantId: ctx.tenantId, surveyId: survey.id, name, anonymous: body.anonymous ?? true, anonymityThreshold: threshold, status: SurveyStatus.DRAFT, opensAt: body.opensAt ? new Date(body.opensAt) : undefined, closesAt: body.closesAt ? new Date(body.closesAt) : undefined, audienceFilter: body.audienceFilter as never, createdById: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "engagement-campaign.created", resourceType: "SurveyCampaign", resourceId: campaign.id, classification: DataClassification.CONFIDENTIAL });
    return campaign;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Survey not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
