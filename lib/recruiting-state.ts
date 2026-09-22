import { ApplicationStage, OfferStatus, RequisitionStatus } from "@prisma/client";
import { asEnumValue } from "@/lib/input-validation";

const applicationTransitions: Record<ApplicationStage, ApplicationStage[]> = {
  APPLIED: [ApplicationStage.SCREENING, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
  SCREENING: [ApplicationStage.INTERVIEW, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
  INTERVIEW: [ApplicationStage.ASSESSMENT, ApplicationStage.OFFER, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
  ASSESSMENT: [ApplicationStage.OFFER, ApplicationStage.INTERVIEW, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
  OFFER: [ApplicationStage.INTERVIEW, ApplicationStage.ASSESSMENT, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
  HIRED: [],
  REJECTED: [ApplicationStage.SCREENING],
  WITHDRAWN: [ApplicationStage.SCREENING]
};

const offerTransitions: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: [OfferStatus.APPROVAL, OfferStatus.WITHDRAWN],
  APPROVAL: [OfferStatus.DRAFT, OfferStatus.SENT, OfferStatus.WITHDRAWN],
  SENT: [OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.EXPIRED, OfferStatus.WITHDRAWN],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [OfferStatus.DRAFT],
  WITHDRAWN: [OfferStatus.DRAFT]
};

const requisitionTransitions: Record<RequisitionStatus, RequisitionStatus[]> = {
  DRAFT: [RequisitionStatus.APPROVAL, RequisitionStatus.CANCELLED],
  APPROVAL: [RequisitionStatus.DRAFT, RequisitionStatus.OPEN, RequisitionStatus.CANCELLED],
  OPEN: [RequisitionStatus.ON_HOLD, RequisitionStatus.CLOSED, RequisitionStatus.CANCELLED],
  ON_HOLD: [RequisitionStatus.OPEN, RequisitionStatus.CLOSED, RequisitionStatus.CANCELLED],
  CLOSED: [],
  CANCELLED: []
};

export function canTransitionApplication(from: ApplicationStage, to: ApplicationStage) {
  return applicationTransitions[from].includes(to);
}

export function canTransitionOffer(from: OfferStatus, to: OfferStatus) {
  return offerTransitions[from].includes(to);
}

export function canTransitionRequisition(from: RequisitionStatus, to: RequisitionStatus) {
  return requisitionTransitions[from].includes(to);
}

export function parseApplicationStage(value: unknown): ApplicationStage | null {
  return asEnumValue(value, Object.values(ApplicationStage));
}

export function parseOfferStatus(value: unknown): OfferStatus | null {
  return asEnumValue(value, Object.values(OfferStatus));
}

export function parseRequisitionStatus(value: unknown): RequisitionStatus | null {
  return asEnumValue(value, Object.values(RequisitionStatus));
}
