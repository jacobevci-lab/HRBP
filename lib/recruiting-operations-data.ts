import { ApplicationStage, PositionStatus, RequisitionStatus } from "@prisma/client";
import { withDb } from "@/lib/db";

export type RecruitingPositionOption = {
  id: string;
  code: string;
  title: string;
  organization: string;
  location: string;
};

export type RecruitingUserOption = {
  id: string;
  name: string;
  role: string;
};

export type RecruitingRequisitionOption = {
  id: string;
  title: string;
  status: string;
  position: string;
};

export type RecruitingApplicationOperation = {
  id: string;
  candidate: string;
  requisition: string;
  stage: string;
  offer: null | {
    id: string;
    status: string;
    currency: string;
    annualBase: string;
    startDate: string;
    expiresAt: string | null;
  };
};

export type RecruitingOperationsData = {
  positions: RecruitingPositionOption[];
  users: RecruitingUserOption[];
  requisitions: RecruitingRequisitionOption[];
  applications: RecruitingApplicationOperation[];
};

export async function getRecruitingOperationsData(tenantId: string): Promise<RecruitingOperationsData> {
  return withDb(async (db) => {
    const [positions, users, requisitions, applications] = await Promise.all([
      db.position.findMany({
        where: { tenantId, validTo: null, status: PositionStatus.OPEN },
        orderBy: [{ critical: "desc" }, { positionCode: "asc" }],
        take: 200,
        select: {
          id: true,
          positionCode: true,
          title: true,
          location: true,
          orgUnit: { select: { name: true } }
        }
      }),
      db.userAccount.findMany({
        where: { tenantId, active: true },
        orderBy: { displayName: "asc" },
        take: 250,
        select: { id: true, displayName: true, role: true }
      }),
      db.requisition.findMany({
        where: { tenantId, status: { in: [RequisitionStatus.DRAFT, RequisitionStatus.APPROVAL, RequisitionStatus.OPEN, RequisitionStatus.ON_HOLD] } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          title: true,
          status: true,
          position: { select: { positionCode: true, title: true } }
        }
      }),
      db.application.findMany({
        where: {
          tenantId,
          stage: { in: [ApplicationStage.APPLIED, ApplicationStage.SCREENING, ApplicationStage.INTERVIEW, ApplicationStage.ASSESSMENT, ApplicationStage.OFFER] }
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          stage: true,
          candidate: { select: { givenName: true, familyName: true } },
          requisition: { select: { title: true } },
          offer: { select: { id: true, status: true, currency: true, annualBase: true, startDate: true, expiresAt: true } }
        }
      })
    ]);

    return {
      positions: positions.map((position) => ({
        id: position.id,
        code: position.positionCode,
        title: position.title,
        organization: position.orgUnit.name,
        location: position.location ?? "—"
      })),
      users: users.map((user) => ({ id: user.id, name: user.displayName, role: user.role })),
      requisitions: requisitions.map((requisition) => ({
        id: requisition.id,
        title: requisition.title,
        status: requisition.status,
        position: requisition.position ? `${requisition.position.positionCode} · ${requisition.position.title}` : "Unassigned position"
      })),
      applications: applications.map((application) => ({
        id: application.id,
        candidate: `${application.candidate.givenName} ${application.candidate.familyName}`,
        requisition: application.requisition.title,
        stage: application.stage,
        offer: application.offer ? {
          id: application.offer.id,
          status: application.offer.status,
          currency: application.offer.currency,
          annualBase: application.offer.annualBase.toString(),
          startDate: application.offer.startDate.toISOString(),
          expiresAt: application.offer.expiresAt?.toISOString() ?? null
        } : null
      }))
    };
  });
}
