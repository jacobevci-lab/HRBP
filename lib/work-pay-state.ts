import { CompensationChangeStatus, LeaveRequestStatus, PayrollRunStatus } from "@prisma/client";

const payrollTransitions: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  DRAFT: [PayrollRunStatus.VALIDATING, PayrollRunStatus.CANCELLED],
  VALIDATING: [PayrollRunStatus.CALCULATED, PayrollRunStatus.EXCEPTION, PayrollRunStatus.CANCELLED],
  CALCULATED: [PayrollRunStatus.APPROVAL, PayrollRunStatus.EXCEPTION, PayrollRunStatus.CANCELLED],
  EXCEPTION: [PayrollRunStatus.VALIDATING, PayrollRunStatus.CANCELLED],
  APPROVAL: [PayrollRunStatus.APPROVED, PayrollRunStatus.EXCEPTION, PayrollRunStatus.CANCELLED],
  APPROVED: [PayrollRunStatus.PAID],
  PAID: [],
  CANCELLED: []
};

const compensationTransitions: Record<CompensationChangeStatus, CompensationChangeStatus[]> = {
  DRAFT: [CompensationChangeStatus.APPROVAL, CompensationChangeStatus.CANCELLED],
  APPROVAL: [CompensationChangeStatus.APPROVED, CompensationChangeStatus.REJECTED, CompensationChangeStatus.CANCELLED],
  APPROVED: [CompensationChangeStatus.APPLIED],
  REJECTED: [],
  APPLIED: [],
  CANCELLED: []
};

const leaveTransitions: Record<LeaveRequestStatus, LeaveRequestStatus[]> = {
  DRAFT: [LeaveRequestStatus.PENDING, LeaveRequestStatus.CANCELLED],
  PENDING: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED, LeaveRequestStatus.CANCELLED],
  APPROVED: [LeaveRequestStatus.TAKEN, LeaveRequestStatus.CANCELLED],
  REJECTED: [],
  CANCELLED: [],
  TAKEN: []
};

export function canTransitionPayroll(from: PayrollRunStatus, to: PayrollRunStatus) {
  return payrollTransitions[from].includes(to);
}

export function canTransitionCompensation(from: CompensationChangeStatus, to: CompensationChangeStatus) {
  return compensationTransitions[from].includes(to);
}

export function canTransitionLeave(from: LeaveRequestStatus, to: LeaveRequestStatus) {
  return leaveTransitions[from].includes(to);
}
