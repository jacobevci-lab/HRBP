import {
  AIInteractionStatus,
  DSRStatus,
  EmploymentStatus,
  PlatformRole,
  SurveyStatus,
  WorkforceScenarioStatus
} from "@prisma/client";
import { withDb } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

function enumLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(value);
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function numberFromJson(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object" && "value" in value) {
    const nested = (value as { value?: unknown }).value;
    return typeof nested === "number" ? nested : typeof nested === "string" && Number.isFinite(Number(nested)) ? Number(nested) : null;
  }
  return null;
}

function displayMetricValue(value: unknown, unit: string) {
  const numeric = numberFromJson(value);
  if (numeric !== null) {
    if (unit === "PERCENT" || unit === "%") return `${numeric}%`;
    if (unit === "DAYS") return `${numeric}d`;
    return numeric.toLocaleString("en-US");
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "—";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function audienceDefinition(value: unknown) {
  if (!value || typeof value !== "object") return { targetCount: null, employmentIds: [], orgUnitIds: [], positionIds: [] };
  const raw = value as { targetCount?: unknown; employmentIds?: unknown; orgUnitIds?: unknown; positionIds?: unknown };
  return {
    targetCount: typeof raw.targetCount === "number" && raw.targetCount > 0 ? raw.targetCount : null,
    employmentIds: asStringArray(raw.employmentIds),
    orgUnitIds: asStringArray(raw.orgUnitIds),
    positionIds: asStringArray(raw.positionIds)
  };
}

type ScopedEmployment = { id: string; positionId: string | null; orgUnitId: string | null };

async function resolveWorkforceProjection(db: Parameters<Parameters<typeof withDb>[0]>[0], ctx: RequestContext) {
  const scope = await resolveEmploymentScope(db, ctx);
  if (scope === null) return {
    relationshipScoped: false,
    employmentIds: null as string[] | null,
    orgUnitIds: null as string[] | null,
    positionIds: null as string[] | null,
    employments: null as ScopedEmployment[] | null
  };

  const rows = scope.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: scope }, status: { not: EmploymentStatus.TERMINATED } },
    select: { id: true, positionId: true, position: { select: { orgUnitId: true } } }
  }) : [];
  const employments = rows.map((row) => ({ id: row.id, positionId: row.positionId, orgUnitId: row.position?.orgUnitId ?? null }));
  return {
    relationshipScoped: true,
    employmentIds: employments.map((row) => row.id),
    orgUnitIds: [...new Set(employments.flatMap((row) => row.orgUnitId ? [row.orgUnitId] : []))],
    positionIds: [...new Set(employments.flatMap((row) => row.positionId ? [row.positionId] : []))],
    employments
  };
}

function campaignVisible(audience: ReturnType<typeof audienceDefinition>, projection: Awaited<ReturnType<typeof resolveWorkforceProjection>>) {
  if (!projection.relationshipScoped) return true;
  const employmentIds = new Set(projection.employmentIds ?? []);
  const orgUnitIds = new Set(projection.orgUnitIds ?? []);
  const positionIds = new Set(projection.positionIds ?? []);
  const hasExplicitSelectors = audience.employmentIds.length > 0 || audience.orgUnitIds.length > 0 || audience.positionIds.length > 0;
  if (!hasExplicitSelectors) return employmentIds.size > 0;
  return audience.employmentIds.some((id) => employmentIds.has(id))
    || audience.orgUnitIds.some((id) => orgUnitIds.has(id))
    || audience.positionIds.some((id) => positionIds.has(id));
}

function scopedCampaignTarget(audience: ReturnType<typeof audienceDefinition>, projection: Awaited<ReturnType<typeof resolveWorkforceProjection>>) {
  if (!projection.relationshipScoped) return audience.targetCount;
  const employments = projection.employments ?? [];
  const hasExplicitSelectors = audience.employmentIds.length > 0 || audience.orgUnitIds.length > 0 || audience.positionIds.length > 0;
  if (!hasExplicitSelectors) return employments.length;
  const explicitEmploymentIds = new Set(audience.employmentIds);
  const explicitOrgUnitIds = new Set(audience.orgUnitIds);
  const explicitPositionIds = new Set(audience.positionIds);
  return employments.filter((employment) => explicitEmploymentIds.has(employment.id)
    || Boolean(employment.orgUnitId && explicitOrgUnitIds.has(employment.orgUnitId))
    || Boolean(employment.positionId && explicitPositionIds.has(employment.positionId))).length;
}

export async function getEngagementLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const projection = await resolveWorkforceProjection(db, ctx);
    const campaigns = await db.surveyCampaign.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        status: true,
        anonymous: true,
        anonymityThreshold: true,
        audienceFilter: true,
        opensAt: true,
        closesAt: true,
        survey: { select: { code: true, name: true } }
      }
    });

    const visibleCampaigns = campaigns.filter((campaign) => campaignVisible(audienceDefinition(campaign.audienceFilter), projection));
    const visibleCampaignIds = visibleCampaigns.map((campaign) => campaign.id);
    const responseGroups = visibleCampaignIds.length ? await db.surveyResponse.groupBy({
      by: ["campaignId"],
      where: {
        tenantId: ctx.tenantId,
        campaignId: { in: visibleCampaignIds },
        ...(projection.relationshipScoped ? { employmentId: { in: projection.employmentIds ?? [] } } : {})
      },
      _count: { _all: true }
    }) : [];
    const responseCountByCampaign = new Map(responseGroups.map((row) => [row.campaignId, row._count._all]));

    const rows = visibleCampaigns.map((campaign) => {
      const audience = audienceDefinition(campaign.audienceFilter);
      const target = scopedCampaignTarget(audience, projection);
      const responses = responseCountByCampaign.get(campaign.id) ?? 0;
      const suppressed = campaign.anonymous && (responses < campaign.anonymityThreshold || (target !== null && target < campaign.anonymityThreshold));
      return {
        id: campaign.id,
        name: campaign.name,
        survey: campaign.survey.name,
        surveyCode: campaign.survey.code,
        status: enumLabel(campaign.status),
        responses,
        target,
        rate: !suppressed && target ? percent(responses, target) : null,
        threshold: campaign.anonymityThreshold,
        mode: campaign.anonymous ? "Anonymous" : "Confidential",
        suppressed,
        opensAt: formatDate(campaign.opensAt),
        closesAt: formatDate(campaign.closesAt)
      };
    });
    const visibleRows = rows.filter((row) => !row.suppressed);
    const rates = visibleRows.filter((row) => row.rate !== null).map((row) => row.rate as number);
    return {
      activeCampaigns: visibleCampaigns.filter((campaign) => campaign.status === SurveyStatus.OPEN || campaign.status === SurveyStatus.SCHEDULED).length,
      responses: visibleRows.reduce((sum, row) => sum + row.responses, 0),
      responseRate: rates.length ? Math.round((rates.reduce((sum, value) => sum + value, 0) / rates.length) * 10) / 10 : 0,
      suppressedCampaigns: rows.filter((row) => row.suppressed).length,
      anonymousCampaigns: visibleCampaigns.filter((campaign) => campaign.anonymous).length,
      relationshipScoped: projection.relationshipScoped,
      rows
    };
  });
}

export async function getWorkforcePlanningLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const projection = await resolveWorkforceProjection(db, ctx);
    const scopedLineWhere = projection.relationshipScoped
      ? ((projection.orgUnitIds?.length || projection.positionIds?.length)
        ? { OR: [
            ...(projection.orgUnitIds?.length ? [{ orgUnitId: { in: projection.orgUnitIds } }] : []),
            ...(projection.positionIds?.length ? [{ positionId: { in: projection.positionIds } }] : [])
          ] }
        : { id: { in: [] as string[] } })
      : {};

    const [scenarios, activeEmployments] = await Promise.all([
      db.workforceScenario.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(projection.relationshipScoped ? { lines: { some: scopedLineWhere } } : {})
        },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 100,
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          baseDate: true,
          horizonMonths: true,
          currency: true,
          ownerId: true,
          approvedAt: true,
          lines: {
            where: scopedLineWhere,
            select: { currentFte: true, plannedFte: true, avgAnnualCost: true, skillsRequired: true }
          }
        }
      }),
      db.employment.count({
        where: {
          tenantId: ctx.tenantId,
          status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE] },
          ...(projection.relationshipScoped ? { id: { in: projection.employmentIds ?? [] } } : {})
        }
      })
    ]);

    const ownerIds = [...new Set(scenarios.map((scenario) => scenario.ownerId))];
    const owners = ownerIds.length ? await db.userAccount.findMany({ where: { tenantId: ctx.tenantId, id: { in: ownerIds } }, select: { id: true, displayName: true } }) : [];
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner.displayName]));

    const rows = scenarios.map((scenario) => {
      const currentFte = scenario.lines.reduce((sum, line) => sum + Number(line.currentFte), 0);
      const plannedFte = scenario.lines.reduce((sum, line) => sum + Number(line.plannedFte), 0);
      const costDelta = scenario.lines.reduce((sum, line) => sum + (Number(line.plannedFte) - Number(line.currentFte)) * Number(line.avgAnnualCost ?? 0), 0);
      const skillSignals = scenario.lines.reduce((sum, line) => sum + (Array.isArray(line.skillsRequired) ? line.skillsRequired.length : 0), 0);
      return {
        id: scenario.id,
        code: scenario.code,
        name: scenario.name,
        status: enumLabel(scenario.status),
        horizonMonths: scenario.horizonMonths,
        currency: scenario.currency,
        currentFte: Math.round(currentFte * 100) / 100,
        plannedFte: Math.round(plannedFte * 100) / 100,
        delta: Math.round((plannedFte - currentFte) * 100) / 100,
        costDelta: Math.round(costDelta),
        skillSignals,
        owner: ownerMap.get(scenario.ownerId) ?? scenario.ownerId,
        baseDate: formatDate(scenario.baseDate)
      };
    });
    const primary = rows.find((row) => row.status === enumLabel(WorkforceScenarioStatus.APPROVED)) ?? rows.find((row) => row.status === enumLabel(WorkforceScenarioStatus.REVIEW)) ?? rows[0] ?? null;

    return {
      activeEmployments,
      scenarioCount: rows.length,
      approvedScenarios: scenarios.filter((scenario) => scenario.status === WorkforceScenarioStatus.APPROVED).length,
      primary,
      relationshipScoped: projection.relationshipScoped,
      rows
    };
  });
}

export async function getAnalyticsLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const definitions = await db.metricDefinition.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 150,
      select: {
        id: true,
        key: true,
        name: true,
        category: true,
        unit: true,
        aggregation: true,
        minPopulation: true,
        snapshots: {
          orderBy: { periodEnd: "desc" },
          take: 1,
          select: { value: true, population: true, suppressed: true, periodStart: true, periodEnd: true, generatedAt: true }
        }
      }
    });

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const rows = definitions.map((definition) => {
      const snapshot = definition.snapshots[0] ?? null;
      const suppressed = Boolean(snapshot && (snapshot.suppressed || snapshot.population < definition.minPopulation));
      return {
        id: definition.id,
        key: definition.key,
        name: definition.name,
        category: definition.category,
        aggregation: definition.aggregation,
        value: snapshot && !suppressed ? displayMetricValue(snapshot.value, definition.unit) : "—",
        population: snapshot?.population ?? 0,
        privacy: suppressed ? "Suppressed" : snapshot ? "Visible" : "No data",
        period: snapshot ? `${formatDate(snapshot.periodStart)} → ${formatDate(snapshot.periodEnd)}` : "—",
        fresh: Boolean(snapshot?.generatedAt && snapshot.generatedAt >= dayAgo)
      };
    });
    return {
      governedMetrics: definitions.length,
      freshToday: rows.filter((row) => row.fresh).length,
      suppressed: rows.filter((row) => row.privacy === "Suppressed").length,
      populated: rows.filter((row) => row.privacy !== "No data").length,
      rows
    };
  });
}

export async function getAIAssistantLiveData(ctx: RequestContext) {
  return withDb(async (db) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const interactions = await db.aIInteraction.findMany({
      where: { tenantId: ctx.tenantId, actorId: ctx.actorId, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        purpose: true,
        module: true,
        status: true,
        classification: true,
        restrictedDataAccess: true,
        decisionSupportOnly: true,
        modelProvider: true,
        modelName: true,
        blockedReason: true,
        createdAt: true,
        completedAt: true,
        promptHash: true,
        responseHash: true
      }
    });

    return {
      requests: interactions.length,
      completed: interactions.filter((interaction) => interaction.status === AIInteractionStatus.COMPLETED).length,
      blocked: interactions.filter((interaction) => interaction.status === AIInteractionStatus.BLOCKED).length,
      restrictedAccessAttempts: interactions.filter((interaction) => interaction.restrictedDataAccess).length,
      decisionSupportOnly: interactions.filter((interaction) => interaction.decisionSupportOnly).length,
      rows: interactions.slice(0, 20).map((interaction) => ({
        id: interaction.id,
        purpose: interaction.purpose,
        module: interaction.module,
        status: enumLabel(interaction.status),
        classification: enumLabel(interaction.classification),
        model: interaction.modelName ? `${interaction.modelProvider ?? "Model"} / ${interaction.modelName}` : "Not recorded",
        createdAt: formatDate(interaction.createdAt),
        promptFingerprint: interaction.promptHash.slice(0, 12),
        responseRecorded: Boolean(interaction.responseHash),
        blockedReason: interaction.blockedReason
      }))
    };
  });
}

const privacyOperationalRoles = new Set<PlatformRole>([
  PlatformRole.LEGAL,
  PlatformRole.PRIVACY_OFFICER
]);

export function canAccessPrivacyOperations(ctx: RequestContext) {
  return privacyOperationalRoles.has(ctx.role);
}

export async function getPrivacyLiveData(ctx: RequestContext) {
  if (!canAccessPrivacyOperations(ctx)) throw new Error("PRIVACY_OPERATIONAL_ACCESS_REQUIRED");
  return withDb(async (db) => {
    const [activities, requests, transfers, assessments] = await Promise.all([
      db.processingActivity.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { updatedAt: "desc" }, take: 150, select: { id: true, code: true, name: true, purpose: true, legalBasis: true, riskRating: true, ownerId: true, specialCategories: true } }),
      db.dataSubjectRequest.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 200, select: { id: true, requestNumber: true, subjectPersonId: true, type: true, status: true, ownerId: true, dueAt: true, verifiedAt: true, createdAt: true } }),
      db.dataTransferRegister.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true, sourceCountry: true, destinationCountry: true, recipient: true, mechanism: true, transferImpactDueAt: true } }),
      db.privacyRiskAssessment.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 100, select: { id: true, name: true, riskLevel: true, requiresDpia: true, status: true, ownerId: true, dueAt: true } })
    ]);

    const openStatuses = new Set<DSRStatus>([DSRStatus.RECEIVED, DSRStatus.IDENTITY_VERIFICATION, DSRStatus.IN_PROGRESS, DSRStatus.WAITING]);
    const openRequests = requests.filter((request) => openStatuses.has(request.status));
    const sevenDays = new Date(Date.now() + 7 * 86_400_000);
    const ownerIds = [...new Set([...activities.map((row) => row.ownerId), ...requests.map((row) => row.ownerId), ...assessments.map((row) => row.ownerId)].filter((value): value is string => Boolean(value)))];
    const owners = ownerIds.length ? await db.userAccount.findMany({ where: { tenantId: ctx.tenantId, id: { in: ownerIds } }, select: { id: true, displayName: true } }) : [];
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner.displayName]));

    return {
      processingActivities: activities.length,
      openDsrs: openRequests.length,
      dsrsDue7: openRequests.filter((request) => request.dueAt <= sevenDays).length,
      dpiaRequired: assessments.filter((assessment) => assessment.requiresDpia && !["COMPLETED", "CLOSED"].includes(assessment.status.toUpperCase())).length,
      activeTransfers: transfers.length,
      dsrs: requests.slice(0, 20).map((request) => ({
        id: request.id,
        requestNumber: request.requestNumber,
        type: enumLabel(request.type),
        status: enumLabel(request.status),
        state: request.verifiedAt ? "Identity verified" : "Verification pending",
        owner: request.ownerId ? ownerMap.get(request.ownerId) ?? request.ownerId : "Unassigned",
        dueAt: formatDate(request.dueAt),
        age: Math.max(0, Math.floor((Date.now() - request.createdAt.getTime()) / 86_400_000))
      })),
      activities: activities.slice(0, 12).map((activity) => ({
        id: activity.id,
        code: activity.code,
        name: activity.name,
        legalBasis: enumLabel(activity.legalBasis),
        risk: activity.riskRating ?? "Not rated",
        specialCategory: Boolean(activity.specialCategories),
        owner: ownerMap.get(activity.ownerId) ?? activity.ownerId
      })),
      transfers: transfers.slice(0, 12).map((transfer) => ({
        id: transfer.id,
        name: transfer.name,
        route: `${transfer.sourceCountry} → ${transfer.destinationCountry}`,
        recipient: transfer.recipient,
        mechanism: enumLabel(transfer.mechanism),
        tiaDueAt: formatDate(transfer.transferImpactDueAt)
      }))
    };
  });
}

export function governanceCapabilityFor(slug: string) {
  if (slug === "engagement") return "engagement:read" as const;
  if (slug === "workforce-planning") return "workforce-plan:read" as const;
  if (slug === "analytics") return "analytics:read" as const;
  if (slug === "ai-assistant") return "ai:use" as const;
  return "privacy:read" as const;
}

export function governanceModeForRole(role: PlatformRole) {
  return role === PlatformRole.EMPLOYEE || role === PlatformRole.MANAGER ? "self" as const : "operations" as const;
}
