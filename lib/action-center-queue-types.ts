export type ActionKind = "workflow" | "hr-service" | "employee-relations" | "documents" | "onboarding" | "offboarding" | "leave" | "time-attendance" | "compensation" | "payroll" | "benefits" | "performance" | "learning" | "development-plan" | "succession" | "recruiting" | "policies" | "workforce-planning" | "privacy" | "engagement";
export type Urgency = "normal" | "warning" | "critical";
export type LifecycleActionItem = {
  id: string;
  kind: ActionKind;
  title: string;
  subtitle: string;
  module: string;
  href: string;
  subjectType: string;
  subjectId: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  urgency: Urgency;
  secondaryAction?: null | {
    type: "reject-leave";
    requestId: string;
  } | {
    type: "reject-time";
    entryId: string;
  } | {
    type: "reject-compensation";
    changeId: string;
  } | {
    type: "return-requisition";
    requisitionId: string;
  } | {
    type: "return-offer";
    offerId: string;
  } | {
    type: "request-policy-changes";
    policyId: string;
  } | {
    type: "request-workforce-changes";
    scenarioId: string;
  } | {
    type: "retire-workflow-definition";
    definitionId: string;
  } | {
    type: "return-engagement-draft";
    campaignId: string;
  };
  action: null | {
    type: "complete-workflow";
    instanceId: string;
    taskId: string;
  } | {
    type: "approve-leave";
    requestId: string;
  } | {
    type: "approve-time";
    entryId: string;
  } | {
    type: "approve-compensation";
    changeId: string;
  } | {
    type: "apply-compensation";
    changeId: string;
  } | {
    type: "approve-payroll";
    runId: string;
  } | {
    type: "mark-payroll-paid";
    runId: string;
  } | {
    type: "approve-requisition";
    requisitionId: string;
  } | {
    type: "approve-offer";
    offerId: string;
  } | {
    type: "approve-policy";
    policyId: string;
  } | {
    type: "approve-workforce-scenario";
    scenarioId: string;
  } | {
    type: "activate-workflow-definition";
    definitionId: string;
  } | {
    type: "open-engagement-campaign";
    campaignId: string;
  } | {
    type: "close-engagement-campaign";
    campaignId: string;
  } | {
    type: "begin-dsr-verification";
    dsrId: string;
  } | {
    type: "verify-dsr";
    dsrId: string;
  } | {
    type: "wait-dsr";
    dsrId: string;
  } | {
    type: "resume-dsr";
    dsrId: string;
  } | {
    type: "start-privacy-assessment";
    assessmentId: string;
  } | {
    type: "wait-privacy-assessment";
    assessmentId: string;
  } | {
    type: "resume-privacy-assessment";
    assessmentId: string;
  } | {
    type: "advance-hr-service";
    requestId: string;
    status: "TRIAGE" | "IN_PROGRESS";
  } | {
    type: "advance-onboarding-task";
    taskId: string;
    status: "IN_PROGRESS" | "COMPLETED";
  } | {
    type: "activate-benefit-enrollment";
    enrollmentId: string;
  } | {
    type: "start-learning-assignment";
    assignmentId: string;
  } | {
    type: "start-performance-self-review";
    reviewId: string;
  } | {
    type: "activate-onboarding-employment";
    planId: string;
  } | {
    type: "advance-offboarding-task";
    processId: string;
    taskId: string;
    status: "IN_PROGRESS" | "COMPLETED";
  } | {
    type: "start-er-corrective-action";
    caseId: string;
    actionId: string;
  } | {
    type: "activate-development-plan";
    planId: string;
  } | {
    type: "start-er-appeal-review";
    caseId: string;
    appealId: string;
  };
};

export type ActionSummary = {
  total: number;
  overdue: number;
  dueSoon: number;
  critical: number;
  workflow: number;
  hrService: number;
  employeeRelations: number;
  documents: number;
  onboarding: number;
  offboarding: number;
  leave: number;
  timeAttendance: number;
  compensation: number;
  payroll: number;
  benefits: number;
  performance: number;
  learning: number;
  developmentPlans: number;
  succession: number;
  recruiting: number;
  policies: number;
  workforcePlanning: number;
  privacy: number;
  engagement: number;
};

export type ActionQueue = { items: LifecycleActionItem[]; summary: ActionSummary; generatedAt: string };
