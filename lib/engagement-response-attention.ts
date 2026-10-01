import { createHmac } from "node:crypto";
import { EmploymentStatus, Prisma, SurveyStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";
import { runtimeString } from "@/lib/runtime-env";

type CampaignCandidate = {
  id: string;
  name: string;
  closesAt: Date | null;
  createdAt: Date;
};

function token(secret: string, tenantId: string, campaignId: string, employmentId: string) {
  return createHmac("sha256", secret)
    .update(`engagement-response:v1:${tenantId}:${campaignId}:${employmentId}`)
    .digest("hex");
}

function canonicalAudienceIds(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as string[];
  const raw = (value as { employmentIds?: unknown }).employmentIds;
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export async function getPendingEngagementResponseCampaigns(ctx: RequestContext): Promise<CampaignCandidate[]> {
  if (!ctx.employmentId || !can(ctx, "engagement:read")) return [];
  const secret = runtimeString("HRBP_ENGAGEMENT_RESPONSE_SECRET");
  if (!secret || secret.length < 32) throw new Error("ENGAGEMENT_RESPONSE_SECRET_REQUIRED");

  const employment = await db.employment.findFirst({
    where: {
      id: ctx.employmentId,
      tenantId: ctx.tenantId,
      status: { not: EmploymentStatus.TERMINATED }
    },
    select: { id: true }
  });
  if (!employment) return [];

  const now = new Date();
  const campaigns = await db.surveyCampaign.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: SurveyStatus.OPEN,
      AND: [
        { OR: [{ opensAt: null }, { opensAt: { lte: now } }] },
        { OR: [{ closesAt: null }, { closesAt: { gt: now } }] }
      ]
    },
    orderBy: [{ closesAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      audienceFilter: true,
      closesAt: true,
      createdAt: true
    }
  });

  const eligible = campaigns.filter((campaign) => {
    const ids = canonicalAudienceIds(campaign.audienceFilter);
    return !ids.length || ids.includes(employment.id);
  });
  if (!eligible.length) return [];

  const tokenByCampaign = new Map(eligible.map((campaign) => [
    campaign.id,
    token(secret, ctx.tenantId, campaign.id, employment.id)
  ]));
  const existing = await db.surveyResponse.findMany({
    where: {
      tenantId: ctx.tenantId,
      campaignId: { in: eligible.map((campaign) => campaign.id) },
      respondentTokenHash: { in: [...tokenByCampaign.values()] }
    },
    select: { campaignId: true, respondentTokenHash: true }
  });
  const answered = new Set(existing
    .filter((response) => tokenByCampaign.get(response.campaignId) === response.respondentTokenHash)
    .map((response) => response.campaignId));

  return eligible
    .filter((campaign) => !answered.has(campaign.id))
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      closesAt: campaign.closesAt,
      createdAt: campaign.createdAt
    }));
}
