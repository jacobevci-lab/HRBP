import { ApplicationStage, OfferStatus, OnboardingStatus, OnboardingTaskStatus, RequisitionStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { onboardingPlanPopulationFilter, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { recruitingApplicationReadFilter, recruitingRequisitionReadFilter } from "@/lib/recruiting-access";
import type { RequestContext } from "@/lib/request-context";

function formatDate(date: Date | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(date);
}

function enumLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export type RecruitingPipelineColumn = {
  stage: string;
  rawStage: ApplicationStage;
  count: number;
  people: Array<{ id: string; name: string; requisition: string; appliedAt: string }>;
};

export type RecruitingRequisitionRow = {
  id: string;
  title: string;
  org: string;
  location: string;
  hiringManager: string;
  recruiter: string;
  candidates: number;
  status: string;
  target: string;
};

export type RecruitingWorkspaceData = {
  openRequisitions: number;
  approvalRequisitions: number;
  activeCandidates: number;
  interviewPipeline: number;
  activeOffers: number;
  awaitingSignature: number;
  pipeline: RecruitingPipelineColumn[];
  requisitions: RecruitingRequisitionRow[];
};

const ACTIVE_APPLICATION_STAGES: ApplicationStage[] = [
  ApplicationStage.APPLIED,
  ApplicationStage.SCREENING,
  ApplicationStage.INTERVIEW,
  ApplicationStage.ASSESSMENT,
  ApplicationStage.OFFER
];

function isActiveOffer(status: OfferStatus) {
  return status === OfferStatus.APPROVAL || status === OfferStatus.SENT || status === OfferStatus.ACCEPTED;
}

export async function getRecruitingWorkspaceData(ctx: RequestContext): Promise<RecruitingWorkspaceData> {
  return withDb(async (db) => {
    const requisitions = await db.requisition.findMany({
      where: recruitingRequisitionReadFilter(ctx),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 150,
      select: {
        id: true,
        title: true,
        status: true,
        targetHireDate: true,
        hiringManagerId: true,
        recruiterId: true,
        position: { select: { location: true, orgUnit: { select: { name: true } } } },
        _count: { select: { applications: true } }
      }
    });

    const requisitionIds = requisitions.map((row) => row.id);
    const applications = requisitionIds.length ? await db.application.findMany({
      where: {
        ...recruitingApplicationReadFilter(ctx),
        requisitionId: { in: requisitionIds }
      },
      orderBy: { appliedAt: "desc" },
      take: 300,
      select: {
        id: true,
        stage: true,
        appliedAt: true,
        candidateId: true,
        candidate: { select: { givenName: true, familyName: true } },
        requisition: { select: { id: true, title: true } },
        offer: { select: { status: true } }
      }
    }) : [];

    const userIds = [...new Set(requisitions.flatMap((row) => [row.hiringManagerId, row.recruiterId]).filter((value): value is string => Boolean(value)))];
    const users = userIds.length ? await db.userAccount.findMany({
      where: { tenantId: ctx.tenantId, id: { in: userIds } },
      select: { id: true, displayName: true }
    }) : [];

    const userName = new Map(users.map((user) => [user.id, user.displayName]));
    const activeApplications = applications.filter((application) => ACTIVE_APPLICATION_STAGES.includes(application.stage));
    const visibleOffers = applications.flatMap((application) => application.offer ? [application.offer] : []);
    const stages: ApplicationStage[] = [ApplicationStage.APPLIED, ApplicationStage.SCREENING, ApplicationStage.INTERVIEW, ApplicationStage.ASSESSMENT, ApplicationStage.OFFER];

    return {
      openRequisitions: requisitions.filter((row) => row.status === RequisitionStatus.OPEN).length,
      approvalRequisitions: requisitions.filter((row) => row.status === RequisitionStatus.APPROVAL).length,
      activeCandidates: new Set(activeApplications.map((row) => row.candidateId)).size,
      interviewPipeline: applications.filter((row) => row.stage === ApplicationStage.INTERVIEW || row.stage === ApplicationStage.ASSESSMENT).length,
      activeOffers: visibleOffers.filter((offer) => isActiveOffer(offer.status)).length,
      awaitingSignature: visibleOffers.filter((offer) => offer.status === OfferStatus.SENT).length,
      pipeline: stages.map((stage) => {
        const rows = applications.filter((application) => application.stage === stage);
        return {
          stage: enumLabel(stage),
          rawStage: stage,
          count: rows.length,
          people: rows.slice(0, 4).map((row) => ({
            id: row.id,
            name: `${row.candidate.givenName} ${row.candidate.familyName}`,
            requisition: row.requisition.title,
            appliedAt: formatDate(row.appliedAt)
          }))
        };
      }),
      requisitions: requisitions.map((row) => ({
        id: row.id,
        title: row.title,
        org: row.position?.orgUnit.name ?? "Unassigned",
        location: row.position?.location ?? "—",
        hiringManager: row.hiringManagerId ? userName.get(row.hiringManagerId) ?? row.hiringManagerId : "Not assigned",
        recruiter: row.recruiterId ? userName.get(row.recruiterId) ?? row.recruiterId : "Not assigned",
        candidates: row._count.applications,
        status: enumLabel(row.status),
        target: formatDate(row.targetHireDate)
      }))
    };
  });
}

export type OnboardingJourneyRow = {
  id: string;
  initials: string;
  name: string;
  role: string;
  start: string;
  owner: string;
  progress: number;
  blockers: number;
  status: string;
};

export type OnboardingTaskControl = {
  title: string;
  owner: string;
  due: string;
  completion: string;
  risk: "Healthy" | "Watch";
};

export type OnboardingWorkspaceData = {
  preboarding: number;
  taskCompletion: number;
  blockers: number;
  readiness: number;
  journeys: OnboardingJourneyRow[];
  controls: OnboardingTaskControl[];
};

export async function getOnboardingWorkspaceData(ctx: RequestContext): Promise<OnboardingWorkspaceData> {
  return withDb(async (db) => {
    const scope = await resolveOnboardingPopulationScope(db, ctx);
    const plans = await db.onboardingPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { not: OnboardingStatus.COMPLETED },
        ...onboardingPlanPopulationFilter(scope)
      },
      orderBy: { targetStartDate: "asc" },
      take: 100,
      select: {
        id: true,
        status: true,
        targetStartDate: true,
        ownerId: true,
        person: { select: { givenName: true, familyName: true } },
        employment: { select: { position: { select: { title: true } } } },
        tasks: { select: { title: true, ownerType: true, status: true, dueDate: true } }
      }
    });

    const ownerIds = [...new Set(plans.flatMap((plan) => plan.ownerId ? [plan.ownerId] : []))];
    const users = ownerIds.length ? await db.userAccount.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ownerIds } },
      select: { id: true, displayName: true }
    }) : [];

    const userName = new Map(users.map((user) => [user.id, user.displayName]));
    const allTasks = plans.flatMap((plan) => plan.tasks);
    const completedTasks = allTasks.filter((task) => task.status === OnboardingTaskStatus.COMPLETED || task.status === OnboardingTaskStatus.WAIVED).length;
    const blockedTasks = allTasks.filter((task) => task.status === OnboardingTaskStatus.BLOCKED).length;
    const taskCompletion = allTasks.length ? Math.round((completedTasks / allTasks.length) * 100) : 100;

    const journeys = plans.map<OnboardingJourneyRow>((plan) => {
      const done = plan.tasks.filter((task) => task.status === OnboardingTaskStatus.COMPLETED || task.status === OnboardingTaskStatus.WAIVED).length;
      const blockers = plan.tasks.filter((task) => task.status === OnboardingTaskStatus.BLOCKED).length;
      const progress = plan.tasks.length ? Math.round((done / plan.tasks.length) * 100) : plan.status === OnboardingStatus.COMPLETED ? 100 : 0;
      return {
        id: plan.id,
        initials: `${plan.person.givenName[0] ?? ""}${plan.person.familyName[0] ?? ""}`.toUpperCase(),
        name: `${plan.person.givenName} ${plan.person.familyName}`,
        role: plan.employment?.position?.title ?? "Position pending",
        start: formatDate(plan.targetStartDate),
        owner: plan.ownerId ? userName.get(plan.ownerId) ?? plan.ownerId : "HR Operations",
        progress,
        blockers,
        status: enumLabel(plan.status)
      };
    });

    const controlMap = new Map<string, { total: number; completed: number; blocked: number; dueDates: Date[] }>();
    for (const task of allTasks) {
      const key = task.ownerType || "Shared";
      const current = controlMap.get(key) ?? { total: 0, completed: 0, blocked: 0, dueDates: [] };
      current.total += 1;
      if (task.status === OnboardingTaskStatus.COMPLETED || task.status === OnboardingTaskStatus.WAIVED) current.completed += 1;
      if (task.status === OnboardingTaskStatus.BLOCKED) current.blocked += 1;
      if (task.dueDate) current.dueDates.push(task.dueDate);
      controlMap.set(key, current);
    }

    const controls = [...controlMap.entries()].map<OnboardingTaskControl>(([owner, stats]) => ({
      title: `${owner} onboarding controls`,
      owner,
      due: stats.dueDates.length ? formatDate(new Date(Math.min(...stats.dueDates.map((date) => date.getTime())))) : "Policy driven",
      completion: `${stats.completed}/${stats.total}`,
      risk: stats.blocked ? "Watch" : "Healthy"
    }));

    const readiness = journeys.length ? Math.round(journeys.reduce((sum, row) => sum + row.progress, 0) / journeys.length) : 100;

    return {
      preboarding: plans.length,
      taskCompletion,
      blockers: blockedTasks,
      readiness,
      journeys,
      controls
    };
  });
}
