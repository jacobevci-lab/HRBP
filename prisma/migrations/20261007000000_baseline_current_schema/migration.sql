-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EmploymentAccessGrantKind" AS ENUM ('HRBP_POPULATION');

-- CreateEnum
CREATE TYPE "EmploymentAccessScopeType" AS ENUM ('EMPLOYMENT', 'ORG_UNIT', 'LEGAL_ENTITY', 'COUNTRY', 'POSITION_TREE');

-- CreateEnum
CREATE TYPE "EmploymentAccessEffect" AS ENUM ('INCLUDE', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "BenefitPlanType" AS ENUM ('HEALTH', 'DENTAL', 'VISION', 'LIFE', 'RETIREMENT', 'MEAL', 'TRANSPORT', 'FLEXIBLE', 'OTHER');

-- CreateEnum
CREATE TYPE "BenefitEnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'WAIVED', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'AT_RISK', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CALIBRATION', 'FINALIZED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_STARTED', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'FINALIZED');

-- CreateEnum
CREATE TYPE "PerformanceBand" AS ENUM ('NEEDS_IMPROVEMENT', 'DEVELOPING', 'MEETS', 'EXCEEDS', 'OUTSTANDING');

-- CreateEnum
CREATE TYPE "PotentialBand" AS ENUM ('LIMITED', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "SuccessionReadiness" AS ENUM ('READY_NOW', 'READY_LT_1_YEAR', 'READY_1_2_YEARS', 'READY_2_PLUS_YEARS');

-- CreateEnum
CREATE TYPE "SkillProficiency" AS ENUM ('AWARENESS', 'FOUNDATION', 'PRACTITIONER', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "LearningAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "DevelopmentPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "SeparationType" AS ENUM ('RESIGNATION', 'TERMINATION', 'REDUNDANCY', 'RETIREMENT', 'END_OF_CONTRACT', 'DEATH', 'OTHER');

-- CreateEnum
CREATE TYPE "SeparationStatus" AS ENUM ('DRAFT', 'NOTICE_PERIOD', 'CLEARANCE', 'FINAL_PAY_REVIEW', 'READY_TO_CLOSE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExitTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'WAIVED');

-- CreateEnum
CREATE TYPE "AssetReturnStatus" AS ENUM ('PENDING', 'RETURNED', 'DAMAGED', 'LOST', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "AccessRevocationStatus" AS ENUM ('PENDING', 'SCHEDULED', 'REVOKED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('SCALE', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'TEXT', 'ENPS');

-- CreateEnum
CREATE TYPE "WorkforceScenarioStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AIInteractionStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalyticsPopulationScope" AS ENUM ('TENANT', 'EMPLOYMENT_SET');

-- CreateEnum
CREATE TYPE "VaultScanStatus" AS ENUM ('PENDING', 'CLEAN', 'QUARANTINED', 'FAILED');

-- CreateEnum
CREATE TYPE "SignatureEnvelopeStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SignatureParticipantStatus" AS ENUM ('PENDING', 'VIEWED', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "IdentityProviderType" AS ENUM ('ENTRA_ID', 'OKTA', 'OIDC', 'SAML', 'LDAP', 'LOCAL');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEGRADED', 'DISABLED');

-- CreateEnum
CREATE TYPE "LegalBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTEREST', 'PUBLIC_TASK', 'LEGITIMATE_INTEREST');

-- CreateEnum
CREATE TYPE "DSRType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION', 'PORTABILITY', 'OBJECTION');

-- CreateEnum
CREATE TYPE "DSRStatus" AS ENUM ('RECEIVED', 'IDENTITY_VERIFICATION', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferMechanism" AS ENUM ('ADEQUACY', 'SCC', 'BCR', 'DEROGATION', 'LOCAL');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PREBOARDING', 'ACTIVE', 'LEAVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('PLANNED', 'OPEN', 'FILLED', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'OPEN', 'INVESTIGATING', 'ACTION_REQUIRED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "OrganizationUnitType" AS ENUM ('LEGAL_ENTITY', 'BUSINESS_UNIT', 'DIVISION', 'DEPARTMENT', 'TEAM', 'COST_CENTER');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('EMPLOYEE', 'MANAGER', 'HRBP', 'HR_OPERATIONS', 'RECRUITER', 'TIME_ADMIN', 'TALENT_ADMIN', 'COMPENSATION_ADMIN', 'PAYROLL_ADMIN', 'ER_INVESTIGATOR', 'LEGAL', 'PRIVACY_OFFICER', 'SECURITY_AUDITOR', 'TENANT_ADMIN');

-- CreateEnum
CREATE TYPE "LifecycleEventType" AS ENUM ('HIRED', 'TRANSFERRED', 'PROMOTED', 'MANAGER_CHANGED', 'COMPENSATION_CHANGED', 'LEAVE_STARTED', 'LEAVE_ENDED', 'TERMINATED', 'REHIRED');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'APPROVAL', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'WAIVED');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'TAKEN');

-- CreateEnum
CREATE TYPE "LeaveUnit" AS ENUM ('DAYS', 'HOURS');

-- CreateEnum
CREATE TYPE "CompensationChangeStatus" AS ENUM ('DRAFT', 'APPROVAL', 'APPROVED', 'REJECTED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'INPUT_LOCKED', 'CALCULATING', 'REVIEW', 'APPROVED', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'VALIDATING', 'CALCULATED', 'EXCEPTION', 'APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollLineType" AS ENUM ('EARNING', 'DEDUCTION', 'TAX', 'EMPLOYER_COST', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "CaseParticipantRole" AS ENUM ('REPORTER', 'SUBJECT', 'WITNESS', 'REPRESENTATIVE', 'ADVISOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AllegationStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'SUBSTANTIATED', 'UNSUBSTANTIATED', 'INCONCLUSIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvestigationFinding" AS ENUM ('SUBSTANTIATED', 'UNSUBSTANTIATED', 'INCONCLUSIVE', 'POLICY_BREACH', 'NO_POLICY_BREACH');

-- CreateEnum
CREATE TYPE "CaseActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseAppealStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'UPHELD', 'OVERTURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'TRIAGE', 'IN_PROGRESS', 'WAITING_EMPLOYEE', 'WAITING_THIRD_PARTY', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServicePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ServiceVisibility" AS ENUM ('REQUESTOR', 'HR_ONLY', 'PRIVATE_NOTE');

-- CreateEnum
CREATE TYPE "ServiceQueueRole" AS ENUM ('OWNER', 'AGENT');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PolicyAssignmentStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "PolicyExceptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkflowDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowTaskStatus" AS ENUM ('PENDING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EmploymentAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employmentId" TEXT,
    "kind" "EmploymentAccessGrantKind" NOT NULL DEFAULT 'HRBP_POPULATION',
    "scopeType" "EmploymentAccessScopeType" NOT NULL DEFAULT 'EMPLOYMENT',
    "scopeKey" TEXT,
    "effect" "EmploymentAccessEffect" NOT NULL DEFAULT 'INCLUDE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentJurisdiction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentJurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCaseStatusTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStatus" "CaseStatus" NOT NULL,
    "toStatus" "CaseStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',

    CONSTRAINT "EmployeeCaseStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseActionStatusTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "fromStatus" "CaseActionStatus" NOT NULL,
    "toStatus" "CaseActionStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',

    CONSTRAINT "CaseActionStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BenefitPlanType" NOT NULL,
    "provider" TEXT,
    "countryCode" TEXT,
    "currency" TEXT,
    "employerContribution" DECIMAL(18,2),
    "employeeContribution" DECIMAL(18,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "BenefitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "benefitPlanId" TEXT NOT NULL,
    "status" "BenefitEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "coverageTier" TEXT,
    "employerContribution" DECIMAL(18,2),
    "employeeContribution" DECIMAL(18,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "parentGoalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(5,2),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" "GoalStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "calibrationAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "managerEmploymentId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "selfRating" "PerformanceBand",
    "managerRating" "PerformanceBand",
    "finalRating" "PerformanceBand",
    "summary" TEXT,
    "calibrationNotes" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "cycleLabel" TEXT NOT NULL,
    "performance" "PerformanceBand" NOT NULL,
    "potential" "PotentialBand" NOT NULL,
    "criticalTalent" BOOLEAN NOT NULL DEFAULT false,
    "assessedById" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',

    CONSTRAINT "TalentAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessionPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "reviewDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuccessionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessionCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "readiness" "SuccessionReadiness" NOT NULL,
    "rank" INTEGER,
    "developmentGap" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentSkill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proficiency" "SkillProficiency" NOT NULL,
    "source" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCourse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "validityMonths" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "outcomeNotes" TEXT,
    "status" "DevelopmentPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT NOT NULL,
    "sourceAssessmentId" TEXT,
    "successionCandidateId" TEXT,
    "focusSkillId" TEXT,
    "targetProficiency" "SkillProficiency",
    "startsAt" TIMESTAMP(3) NOT NULL,
    "targetAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevelopmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "successionCandidateId" TEXT,
    "developmentPlanId" TEXT,
    "developmentSkillId" TEXT,
    "targetProficiency" "SkillProficiency",
    "status" "LearningAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "score" DECIMAL(5,2),
    "certificateReference" TEXT,

    CONSTRAINT "LearningAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRServiceStatusTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "ServiceRequestStatus" NOT NULL,
    "toStatus" "ServiceRequestStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "queue" TEXT,
    "assigneeId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',

    CONSTRAINT "HRServiceStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRServiceSlaPause" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "pausedFromStatus" "ServiceRequestStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "pausedById" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedById" TEXT,
    "resumedAt" TIMESTAMP(3),
    "remainingMinutes" INTEGER,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',

    CONSTRAINT "HRServiceSlaPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "recipientUserId" TEXT,
    "recipientRole" TEXT,
    "templateKey" TEXT,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeparationProcess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "type" "SeparationType" NOT NULL,
    "status" "SeparationStatus" NOT NULL DEFAULT 'DRAFT',
    "noticeDate" TIMESTAMP(3),
    "lastWorkingDate" TIMESTAMP(3) NOT NULL,
    "reasonCode" TEXT,
    "employeeReason" TEXT,
    "initiatedById" TEXT NOT NULL,
    "managerEmploymentId" TEXT,
    "rehireEligible" BOOLEAN,
    "rehireDecisionReason" TEXT,
    "rehireDecisionById" TEXT,
    "rehireDecisionAt" TIMESTAMP(3),
    "replacementRequired" BOOLEAN,
    "replacementDecisionReason" TEXT,
    "replacementDecisionById" TEXT,
    "replacementDecisionAt" TIMESTAMP(3),
    "replacementRequisitionId" TEXT,
    "finalSettlementStatus" TEXT,
    "finalSettlementNote" TEXT,
    "finalSettlementPreparedById" TEXT,
    "finalSettlementPreparedAt" TIMESTAMP(3),
    "finalSettlementApprovedById" TEXT,
    "finalSettlementApprovedAt" TIMESTAMP(3),
    "finalSettlementSettledById" TEXT,
    "finalSettlementSettledAt" TIMESTAMP(3),
    "finalSettlementReversalReason" TEXT,
    "finalSettlementReversedById" TEXT,
    "finalSettlementReversedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SeparationProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeparationScheduleAmendment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "previousNoticeDate" TIMESTAMP(3),
    "newNoticeDate" TIMESTAMP(3),
    "previousLastWorkingDate" TIMESTAMP(3) NOT NULL,
    "newLastWorkingDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',

    CONSTRAINT "SeparationScheduleAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeparationManagerReassignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "reportEmploymentId" TEXT NOT NULL,
    "previousManagerEmploymentId" TEXT NOT NULL,
    "newManagerEmploymentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',

    CONSTRAINT "SeparationManagerReassignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeparationTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "ExitTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "evidenceDocumentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeparationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" "AssetReturnStatus" NOT NULL DEFAULT 'PENDING',
    "returnedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "conditionNote" TEXT,

    CONSTRAINT "AssetReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRevocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "accountId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "status" "AccessRevocationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "exceptionReason" TEXT,

    CONSTRAINT "AccessRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitInterview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "conductedAt" TIMESTAMP(3) NOT NULL,
    "reasons" JSONB,
    "comments" TEXT,
    "wouldRecommend" BOOLEAN,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExitInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeTransfer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "recipientId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "ExitTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementSurvey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "SurveyQuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL,
    "options" JSONB,
    "dimension" TEXT,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "anonymityThreshold" INTEGER NOT NULL DEFAULT 7,
    "audienceFilter" JSONB,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "respondentTokenHash" TEXT NOT NULL,
    "employmentId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAnswer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceScenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkforceScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "baseDate" TIMESTAMP(3) NOT NULL,
    "horizonMonths" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "assumptions" JSONB,
    "ownerId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforcePlanLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "positionId" TEXT,
    "roleLabel" TEXT NOT NULL,
    "location" TEXT,
    "currentFte" DECIMAL(10,2) NOT NULL,
    "plannedFte" DECIMAL(10,2) NOT NULL,
    "avgAnnualCost" DECIMAL(18,2),
    "demandDriver" TEXT,
    "skillsRequired" JSONB,

    CONSTRAINT "WorkforcePlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "aggregation" TEXT NOT NULL,
    "minPopulation" INTEGER NOT NULL DEFAULT 7,
    "sensitiveDimensions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "value" JSONB NOT NULL,
    "dimensions" JSONB,
    "population" INTEGER NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "populationScope" "AnalyticsPopulationScope" NOT NULL DEFAULT 'TENANT',
    "scopeFingerprint" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInteraction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "status" "AIInteractionStatus" NOT NULL DEFAULT 'RECEIVED',
    "promptHash" TEXT NOT NULL,
    "responseHash" TEXT,
    "sourceRefs" JSONB,
    "classification" "DataClassification" NOT NULL DEFAULT 'INTERNAL',
    "restrictedDataAccess" BOOLEAN NOT NULL DEFAULT false,
    "decisionSupportOnly" BOOLEAN NOT NULL DEFAULT true,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "contentHash" TEXT NOT NULL,
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',
    "scanStatus" "VaultScanStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3),
    "scanCompletedAt" TIMESTAMP(3),
    "scanEngine" TEXT,
    "scanReference" TEXT,
    "scanMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "purpose" TEXT,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEnvelope" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "title" TEXT NOT NULL,
    "status" "SignatureEnvelopeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureParticipant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "employmentId" TEXT,
    "email" TEXT,
    "signingOrder" INTEGER NOT NULL DEFAULT 1,
    "status" "SignatureParticipantStatus" NOT NULL DEFAULT 'PENDING',
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),

    CONSTRAINT "SignatureParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityProviderConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IdentityProviderType" NOT NULL,
    "issuer" TEXT,
    "clientId" TEXT,
    "metadataUrl" TEXT,
    "directoryTenantId" TEXT,
    "secretRef" TEXT,
    "scimEnabled" BOOLEAN NOT NULL DEFAULT false,
    "jitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemType" TEXT NOT NULL,
    "baseUrl" TEXT,
    "authType" TEXT NOT NULL,
    "secretRef" TEXT,
    "scopes" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "lastValidatedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSecurityPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataRegion" TEXT NOT NULL,
    "kmsKeyRef" TEXT,
    "customerManagedKey" BOOLEAN NOT NULL DEFAULT false,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT true,
    "sessionMaxMinutes" INTEGER NOT NULL DEFAULT 480,
    "exportRestrictedData" BOOLEAN NOT NULL DEFAULT false,
    "downloadWatermarking" BOOLEAN NOT NULL DEFAULT true,
    "deviceTrustRequired" BOOLEAN NOT NULL DEFAULT false,
    "breakGlassEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSecurityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "legalBasis" "LegalBasis" NOT NULL,
    "legitimateInterest" TEXT,
    "dataSubjects" JSONB NOT NULL,
    "dataCategories" JSONB NOT NULL,
    "specialCategories" JSONB,
    "recipients" JSONB,
    "systems" JSONB,
    "countries" JSONB,
    "retentionRuleId" TEXT,
    "ownerId" TEXT NOT NULL,
    "riskRating" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "classification" "DataClassification" NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "legalBasis" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "subjectPersonId" TEXT NOT NULL,
    "type" "DSRType" NOT NULL,
    "status" "DSRStatus" NOT NULL DEFAULT 'RECEIVED',
    "channel" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTransferRegister" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceCountry" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "dataCategories" JSONB NOT NULL,
    "purpose" TEXT NOT NULL,
    "mechanism" "TransferMechanism" NOT NULL,
    "safeguardReference" TEXT,
    "transferImpactDueAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTransferRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRiskAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processingActivityId" TEXT,
    "name" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "requiresDpia" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "findings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "role" "PlatformRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "localAuthEnabled" BOOLEAN NOT NULL DEFAULT false,
    "localPasswordHash" TEXT,
    "localPasswordUpdatedAt" TIMESTAMP(3),
    "localFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "localLockedUntil" TIMESTAMP(3),
    "lastLocalLoginAt" TIMESTAMP(3),

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "workEmail" TEXT,
    "personalEmail" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalIdentity" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "nationalIdHash" TEXT,
    "bankToken" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',

    CONSTRAINT "PersonalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationUnitType" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "OrganizationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "positionCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobFamily" TEXT,
    "grade" TEXT,
    "location" TEXT,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "positionId" TEXT,
    "managerEmploymentId" TEXT,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'PREBOARDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationHistory" (
    "id" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "annualBase" DECIMAL(18,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "CompensationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "positionId" TEXT,
    "title" TEXT NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "hiringManagerId" TEXT,
    "recruiterId" TEXT,
    "targetHireDate" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "givenName" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "privacyNoticeVersion" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',
    "hiredPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "source" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "annualBase" DECIMAL(18,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "employmentId" TEXT,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "targetStartDate" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "dueDate" TIMESTAMP(3),
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "weeklyMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkScheduleAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "WorkScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "LeaveUnit" NOT NULL DEFAULT 'DAYS',
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "annualAllowance" DECIMAL(8,2),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "opening" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "accrued" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(8,2) NOT NULL DEFAULT 0,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "units" DECIMAL(8,2) NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "currentAnnualBase" DECIMAL(18,2),
    "proposedAnnualBase" DECIMAL(18,2) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "status" "CompensationChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompensationChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCountryPack" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "PayrollCountryPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "countryPackId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payrollPeriodId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "grossPay" DECIMAL(18,2) NOT NULL,
    "taxablePay" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "deductions" DECIMAL(18,2) NOT NULL,
    "netPay" DECIMAL(18,2) NOT NULL,
    "employerCost" DECIMAL(18,2),
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLineItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payrollResultId" TEXT NOT NULL,
    "type" "PayrollLineType" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(12,4),
    "rate" DECIMAL(18,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PayrollLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectPersonId" TEXT,
    "caseNumber" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
    "ownerUserId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAssignment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT,
    "caseId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "classification" "DataClassification" NOT NULL DEFAULT 'RESTRICTED',
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLifecycleEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "employmentId" TEXT,
    "type" "LifecycleEventType" NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "purpose" TEXT,
    "classification" "DataClassification" NOT NULL,
    "ipAddress" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "previousHash" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseParticipant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "personId" TEXT,
    "employmentId" TEXT,
    "externalName" TEXT,
    "role" "CaseParticipantRole" NOT NULL,
    "confidential" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "CaseParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAllegation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT,
    "status" "AllegationStatus" NOT NULL DEFAULT 'OPEN',
    "policyCode" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',

    CONSTRAINT "CaseAllegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseInterview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "participantId" TEXT,
    "interviewerId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" TEXT,
    "transcriptDocumentId" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT,
    "label" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "source" TEXT,
    "checksum" TEXT,
    "collectedById" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',

    CONSTRAINT "CaseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "allegationId" TEXT,
    "finding" "InvestigationFinding" NOT NULL,
    "rationale" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',

    CONSTRAINT "CaseFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "subjectEmploymentId" TEXT,
    "actionType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "CaseActionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAppeal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "grounds" TEXT NOT NULL,
    "status" "CaseAppealStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewerId" TEXT,
    "decision" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_RESTRICTED',

    CONSTRAINT "CaseAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRServiceRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestorId" TEXT NOT NULL,
    "subjectEmploymentId" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ServicePriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "queue" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "escalationReason" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HRServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRServiceComment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "ServiceVisibility" NOT NULL DEFAULT 'REQUESTOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HRServiceComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRServiceQueue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultSlaMinutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HRServiceQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRServiceQueueMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ServiceQueueRole" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HRServiceQueueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "jurisdiction" TEXT,
    "audience" TEXT,
    "ownerId" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "PolicyAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAcknowledgement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acknowledgedBy" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "PolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyException" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "employmentId" TEXT,
    "reason" TEXT NOT NULL,
    "compensatingControl" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "status" "PolicyExceptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "triggerType" TEXT NOT NULL,
    "status" "WorkflowDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStepDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "assigneeRole" TEXT,
    "approvalMode" TEXT,
    "slaMinutes" INTEGER,
    "configuration" JSONB,

    CONSTRAINT "WorkflowStepDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "startedById" TEXT NOT NULL,
    "context" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeRole" TEXT,
    "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmploymentAccessGrant_tenantId_userId_kind_effect_validTo_idx" ON "EmploymentAccessGrant"("tenantId", "userId", "kind", "effect", "validTo");

-- CreateIndex
CREATE INDEX "EmploymentAccessGrant_tenantId_employmentId_validTo_idx" ON "EmploymentAccessGrant"("tenantId", "employmentId", "validTo");

-- CreateIndex
CREATE INDEX "EmploymentAccessGrant_tenantId_scopeType_scopeKey_effect_va_idx" ON "EmploymentAccessGrant"("tenantId", "scopeType", "scopeKey", "effect", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentAccessGrant_tenantId_userId_employmentId_kind_key" ON "EmploymentAccessGrant"("tenantId", "userId", "employmentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentAccessGrant_tenantId_userId_scopeType_scopeKey_ef_key" ON "EmploymentAccessGrant"("tenantId", "userId", "scopeType", "scopeKey", "effect");

-- CreateIndex
CREATE INDEX "EmploymentJurisdiction_tenantId_countryCode_effectiveTo_idx" ON "EmploymentJurisdiction"("tenantId", "countryCode", "effectiveTo");

-- CreateIndex
CREATE INDEX "EmploymentJurisdiction_tenantId_employmentId_effectiveTo_idx" ON "EmploymentJurisdiction"("tenantId", "employmentId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentJurisdiction_employmentId_effectiveFrom_key" ON "EmploymentJurisdiction"("employmentId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeCaseStatusTransition_tenantId_caseId_occurredAt_idx" ON "EmployeeCaseStatusTransition"("tenantId", "caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmployeeCaseStatusTransition_tenantId_toStatus_occurredAt_idx" ON "EmployeeCaseStatusTransition"("tenantId", "toStatus", "occurredAt");

-- CreateIndex
CREATE INDEX "CaseActionStatusTransition_tenantId_caseId_occurredAt_idx" ON "CaseActionStatusTransition"("tenantId", "caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "CaseActionStatusTransition_tenantId_actionId_occurredAt_idx" ON "CaseActionStatusTransition"("tenantId", "actionId", "occurredAt");

-- CreateIndex
CREATE INDEX "BenefitPlan_tenantId_active_type_idx" ON "BenefitPlan"("tenantId", "active", "type");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitPlan_tenantId_code_effectiveFrom_key" ON "BenefitPlan"("tenantId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "BenefitEnrollment_tenantId_employmentId_status_idx" ON "BenefitEnrollment"("tenantId", "employmentId", "status");

-- CreateIndex
CREATE INDEX "BenefitEnrollment_tenantId_status_effectiveTo_idx" ON "BenefitEnrollment"("tenantId", "status", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitEnrollment_employmentId_benefitPlanId_effectiveFrom_key" ON "BenefitEnrollment"("employmentId", "benefitPlanId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Goal_tenantId_employmentId_status_idx" ON "Goal"("tenantId", "employmentId", "status");

-- CreateIndex
CREATE INDEX "Goal_tenantId_dueAt_status_idx" ON "Goal"("tenantId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "ReviewCycle_tenantId_status_endsAt_idx" ON "ReviewCycle"("tenantId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCycle_tenantId_name_key" ON "ReviewCycle"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PerformanceReview_tenantId_employmentId_status_idx" ON "PerformanceReview"("tenantId", "employmentId", "status");

-- CreateIndex
CREATE INDEX "PerformanceReview_tenantId_status_cycleId_idx" ON "PerformanceReview"("tenantId", "status", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_cycleId_employmentId_key" ON "PerformanceReview"("cycleId", "employmentId");

-- CreateIndex
CREATE INDEX "TalentAssessment_tenantId_cycleLabel_potential_performance_idx" ON "TalentAssessment"("tenantId", "cycleLabel", "potential", "performance");

-- CreateIndex
CREATE UNIQUE INDEX "TalentAssessment_tenantId_employmentId_cycleLabel_key" ON "TalentAssessment"("tenantId", "employmentId", "cycleLabel");

-- CreateIndex
CREATE INDEX "SuccessionPlan_tenantId_active_reviewDueAt_idx" ON "SuccessionPlan"("tenantId", "active", "reviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuccessionPlan_tenantId_positionId_key" ON "SuccessionPlan"("tenantId", "positionId");

-- CreateIndex
CREATE INDEX "SuccessionCandidate_tenantId_employmentId_idx" ON "SuccessionCandidate"("tenantId", "employmentId");

-- CreateIndex
CREATE INDEX "SuccessionCandidate_tenantId_readiness_idx" ON "SuccessionCandidate"("tenantId", "readiness");

-- CreateIndex
CREATE UNIQUE INDEX "SuccessionCandidate_planId_employmentId_key" ON "SuccessionCandidate"("planId", "employmentId");

-- CreateIndex
CREATE INDEX "Skill_tenantId_active_category_idx" ON "Skill"("tenantId", "active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_tenantId_code_key" ON "Skill"("tenantId", "code");

-- CreateIndex
CREATE INDEX "EmploymentSkill_tenantId_employmentId_idx" ON "EmploymentSkill"("tenantId", "employmentId");

-- CreateIndex
CREATE INDEX "EmploymentSkill_tenantId_skillId_proficiency_idx" ON "EmploymentSkill"("tenantId", "skillId", "proficiency");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentSkill_employmentId_skillId_key" ON "EmploymentSkill"("employmentId", "skillId");

-- CreateIndex
CREATE INDEX "LearningCourse_tenantId_active_mandatory_idx" ON "LearningCourse"("tenantId", "active", "mandatory");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCourse_tenantId_code_key" ON "LearningCourse"("tenantId", "code");

-- CreateIndex
CREATE INDEX "DevelopmentPlan_tenantId_employmentId_status_idx" ON "DevelopmentPlan"("tenantId", "employmentId", "status");

-- CreateIndex
CREATE INDEX "DevelopmentPlan_tenantId_ownerId_status_idx" ON "DevelopmentPlan"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "DevelopmentPlan_tenantId_targetAt_status_idx" ON "DevelopmentPlan"("tenantId", "targetAt", "status");

-- CreateIndex
CREATE INDEX "DevelopmentPlan_tenantId_successionCandidateId_status_idx" ON "DevelopmentPlan"("tenantId", "successionCandidateId", "status");

-- CreateIndex
CREATE INDEX "LearningAssignment_tenantId_employmentId_idx" ON "LearningAssignment"("tenantId", "employmentId");

-- CreateIndex
CREATE INDEX "LearningAssignment_tenantId_status_dueAt_idx" ON "LearningAssignment"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "LearningAssignment_tenantId_successionCandidateId_status_idx" ON "LearningAssignment"("tenantId", "successionCandidateId", "status");

-- CreateIndex
CREATE INDEX "LearningAssignment_tenantId_developmentPlanId_status_idx" ON "LearningAssignment"("tenantId", "developmentPlanId", "status");

-- CreateIndex
CREATE INDEX "LearningAssignment_tenantId_developmentSkillId_targetProfic_idx" ON "LearningAssignment"("tenantId", "developmentSkillId", "targetProficiency");

-- CreateIndex
CREATE UNIQUE INDEX "LearningAssignment_employmentId_courseId_assignedAt_key" ON "LearningAssignment"("employmentId", "courseId", "assignedAt");

-- CreateIndex
CREATE INDEX "HRServiceStatusTransition_tenantId_requestId_occurredAt_idx" ON "HRServiceStatusTransition"("tenantId", "requestId", "occurredAt");

-- CreateIndex
CREATE INDEX "HRServiceStatusTransition_tenantId_toStatus_occurredAt_idx" ON "HRServiceStatusTransition"("tenantId", "toStatus", "occurredAt");

-- CreateIndex
CREATE INDEX "HRServiceSlaPause_tenantId_requestId_resumedAt_idx" ON "HRServiceSlaPause"("tenantId", "requestId", "resumedAt");

-- CreateIndex
CREATE INDEX "HRServiceSlaPause_tenantId_pausedAt_idx" ON "HRServiceSlaPause"("tenantId", "pausedAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_createdAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_recipientUserId_channel_status__idx" ON "NotificationOutbox"("tenantId", "recipientUserId", "channel", "status", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_recipientRole_channel_status_re_idx" ON "NotificationOutbox"("tenantId", "recipientRole", "channel", "status", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_eventType_createdAt_idx" ON "NotificationOutbox"("tenantId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_resourceType_resourceId_idx" ON "NotificationOutbox"("tenantId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_tenantId_dedupeKey_key" ON "NotificationOutbox"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SeparationProcess_tenantId_employmentId_status_idx" ON "SeparationProcess"("tenantId", "employmentId", "status");

-- CreateIndex
CREATE INDEX "SeparationProcess_tenantId_lastWorkingDate_status_idx" ON "SeparationProcess"("tenantId", "lastWorkingDate", "status");

-- CreateIndex
CREATE INDEX "SeparationProcess_tenantId_replacementRequisitionId_idx" ON "SeparationProcess"("tenantId", "replacementRequisitionId");

-- CreateIndex
CREATE INDEX "SeparationScheduleAmendment_tenantId_processId_changedAt_idx" ON "SeparationScheduleAmendment"("tenantId", "processId", "changedAt");

-- CreateIndex
CREATE INDEX "SeparationScheduleAmendment_tenantId_changedAt_idx" ON "SeparationScheduleAmendment"("tenantId", "changedAt");

-- CreateIndex
CREATE INDEX "SeparationManagerReassignment_tenantId_processId_changedAt_idx" ON "SeparationManagerReassignment"("tenantId", "processId", "changedAt");

-- CreateIndex
CREATE INDEX "SeparationManagerReassignment_tenantId_reportEmploymentId_c_idx" ON "SeparationManagerReassignment"("tenantId", "reportEmploymentId", "changedAt");

-- CreateIndex
CREATE INDEX "SeparationManagerReassignment_tenantId_newManagerEmployment_idx" ON "SeparationManagerReassignment"("tenantId", "newManagerEmploymentId", "changedAt");

-- CreateIndex
CREATE INDEX "SeparationTask_tenantId_processId_status_idx" ON "SeparationTask"("tenantId", "processId", "status");

-- CreateIndex
CREATE INDEX "SeparationTask_tenantId_ownerId_dueAt_idx" ON "SeparationTask"("tenantId", "ownerId", "dueAt");

-- CreateIndex
CREATE INDEX "AssetReturn_tenantId_processId_status_idx" ON "AssetReturn"("tenantId", "processId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssetReturn_processId_assetTag_key" ON "AssetReturn"("processId", "assetTag");

-- CreateIndex
CREATE INDEX "AccessRevocation_tenantId_processId_status_idx" ON "AccessRevocation"("tenantId", "processId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRevocation_processId_systemName_accountId_key" ON "AccessRevocation"("processId", "systemName", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitInterview_processId_key" ON "ExitInterview"("processId");

-- CreateIndex
CREATE INDEX "ExitInterview_tenantId_conductedAt_idx" ON "ExitInterview"("tenantId", "conductedAt");

-- CreateIndex
CREATE INDEX "KnowledgeTransfer_tenantId_processId_status_idx" ON "KnowledgeTransfer"("tenantId", "processId", "status");

-- CreateIndex
CREATE INDEX "EngagementSurvey_tenantId_name_idx" ON "EngagementSurvey"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementSurvey_tenantId_code_key" ON "EngagementSurvey"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SurveyQuestion_tenantId_surveyId_orderIndex_idx" ON "SurveyQuestion"("tenantId", "surveyId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyQuestion_surveyId_questionKey_key" ON "SurveyQuestion"("surveyId", "questionKey");

-- CreateIndex
CREATE INDEX "SurveyCampaign_tenantId_status_opensAt_idx" ON "SurveyCampaign"("tenantId", "status", "opensAt");

-- CreateIndex
CREATE INDEX "SurveyResponse_tenantId_campaignId_submittedAt_idx" ON "SurveyResponse"("tenantId", "campaignId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_campaignId_respondentTokenHash_key" ON "SurveyResponse"("campaignId", "respondentTokenHash");

-- CreateIndex
CREATE INDEX "SurveyAnswer_tenantId_questionId_idx" ON "SurveyAnswer"("tenantId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAnswer_responseId_questionId_key" ON "SurveyAnswer"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "WorkforceScenario_tenantId_status_baseDate_idx" ON "WorkforceScenario"("tenantId", "status", "baseDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceScenario_tenantId_code_key" ON "WorkforceScenario"("tenantId", "code");

-- CreateIndex
CREATE INDEX "WorkforcePlanLine_tenantId_scenarioId_orgUnitId_idx" ON "WorkforcePlanLine"("tenantId", "scenarioId", "orgUnitId");

-- CreateIndex
CREATE INDEX "WorkforcePlanLine_tenantId_positionId_idx" ON "WorkforcePlanLine"("tenantId", "positionId");

-- CreateIndex
CREATE INDEX "MetricDefinition_tenantId_category_active_idx" ON "MetricDefinition"("tenantId", "category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MetricDefinition_tenantId_key_key" ON "MetricDefinition"("tenantId", "key");

-- CreateIndex
CREATE INDEX "MetricSnapshot_tenantId_metricId_periodEnd_idx" ON "MetricSnapshot"("tenantId", "metricId", "periodEnd");

-- CreateIndex
CREATE INDEX "MetricSnapshot_tenantId_suppressed_generatedAt_idx" ON "MetricSnapshot"("tenantId", "suppressed", "generatedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_tenantId_metricId_populationScope_scopeFinge_idx" ON "MetricSnapshot"("tenantId", "metricId", "populationScope", "scopeFingerprint", "periodEnd");

-- CreateIndex
CREATE INDEX "AIInteraction_tenantId_actorId_createdAt_idx" ON "AIInteraction"("tenantId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteraction_tenantId_module_status_idx" ON "AIInteraction"("tenantId", "module", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_objectKey_key" ON "DocumentVersion"("objectKey");

-- CreateIndex
CREATE INDEX "DocumentVersion_tenantId_documentId_createdAt_idx" ON "DocumentVersion"("tenantId", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentVersion_tenantId_scanStatus_idx" ON "DocumentVersion"("tenantId", "scanStatus");

-- CreateIndex
CREATE INDEX "DocumentVersion_tenantId_uploadedAt_scanStatus_idx" ON "DocumentVersion"("tenantId", "uploadedAt", "scanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "DocumentAccessGrant_tenantId_principalId_expiresAt_idx" ON "DocumentAccessGrant"("tenantId", "principalId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAccessGrant_documentId_principalType_principalId_pe_key" ON "DocumentAccessGrant"("documentId", "principalType", "principalId", "permission");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_tenantId_documentId_status_idx" ON "SignatureEnvelope"("tenantId", "documentId", "status");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_tenantId_documentVersionId_idx" ON "SignatureEnvelope"("tenantId", "documentVersionId");

-- CreateIndex
CREATE INDEX "SignatureParticipant_tenantId_envelopeId_signingOrder_idx" ON "SignatureParticipant"("tenantId", "envelopeId", "signingOrder");

-- CreateIndex
CREATE INDEX "SignatureEvent_tenantId_envelopeId_occurredAt_idx" ON "SignatureEvent"("tenantId", "envelopeId", "occurredAt");

-- CreateIndex
CREATE INDEX "IdentityProviderConnection_tenantId_status_type_idx" ON "IdentityProviderConnection"("tenantId", "status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityProviderConnection_tenantId_name_key" ON "IdentityProviderConnection"("tenantId", "name");

-- CreateIndex
CREATE INDEX "IntegrationConnection_tenantId_enabled_status_idx" ON "IntegrationConnection"("tenantId", "enabled", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_tenantId_name_key" ON "IntegrationConnection"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSecurityPolicy_tenantId_key" ON "TenantSecurityPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_tenantId_active_channel_idx" ON "NotificationTemplate"("tenantId", "active", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_tenantId_key_locale_channel_key" ON "NotificationTemplate"("tenantId", "key", "locale", "channel");

-- CreateIndex
CREATE INDEX "ProcessingActivity_tenantId_legalBasis_active_idx" ON "ProcessingActivity"("tenantId", "legalBasis", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingActivity_tenantId_code_key" ON "ProcessingActivity"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RetentionRule_tenantId_active_resourceType_idx" ON "RetentionRule"("tenantId", "active", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRule_tenantId_resourceType_jurisdiction_classifica_key" ON "RetentionRule"("tenantId", "resourceType", "jurisdiction", "classification");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_tenantId_status_dueAt_idx" ON "DataSubjectRequest"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_tenantId_subjectPersonId_createdAt_idx" ON "DataSubjectRequest"("tenantId", "subjectPersonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataSubjectRequest_tenantId_requestNumber_key" ON "DataSubjectRequest"("tenantId", "requestNumber");

-- CreateIndex
CREATE INDEX "DataTransferRegister_tenantId_active_destinationCountry_idx" ON "DataTransferRegister"("tenantId", "active", "destinationCountry");

-- CreateIndex
CREATE INDEX "PrivacyRiskAssessment_tenantId_status_dueAt_idx" ON "PrivacyRiskAssessment"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "PrivacyRiskAssessment_tenantId_processingActivityId_idx" ON "PrivacyRiskAssessment"("tenantId", "processingActivityId");

-- CreateIndex
CREATE INDEX "UserAccount_tenantId_role_idx" ON "UserAccount"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_tenantId_subject_key" ON "UserAccount"("tenantId", "subject");

-- CreateIndex
CREATE INDEX "Person_tenantId_familyName_givenName_idx" ON "Person"("tenantId", "familyName", "givenName");

-- CreateIndex
CREATE UNIQUE INDEX "Person_tenantId_employeeNumber_key" ON "Person"("tenantId", "employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalIdentity_personId_key" ON "PersonalIdentity"("personId");

-- CreateIndex
CREATE INDEX "OrganizationUnit_tenantId_parentId_idx" ON "OrganizationUnit"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "OrganizationUnit_tenantId_type_validTo_idx" ON "OrganizationUnit"("tenantId", "type", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUnit_tenantId_code_validFrom_key" ON "OrganizationUnit"("tenantId", "code", "validFrom");

-- CreateIndex
CREATE INDEX "Position_tenantId_status_validTo_idx" ON "Position"("tenantId", "status", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "Position_tenantId_positionCode_validFrom_key" ON "Position"("tenantId", "positionCode", "validFrom");

-- CreateIndex
CREATE INDEX "Employment_tenantId_personId_status_idx" ON "Employment"("tenantId", "personId", "status");

-- CreateIndex
CREATE INDEX "Employment_tenantId_managerEmploymentId_idx" ON "Employment"("tenantId", "managerEmploymentId");

-- CreateIndex
CREATE INDEX "CompensationHistory_employmentId_effectiveFrom_idx" ON "CompensationHistory"("employmentId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Requisition_tenantId_status_idx" ON "Requisition"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Requisition_tenantId_positionId_idx" ON "Requisition"("tenantId", "positionId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_hiredPersonId_key" ON "Candidate"("hiredPersonId");

-- CreateIndex
CREATE INDEX "Candidate_tenantId_retentionUntil_idx" ON "Candidate"("tenantId", "retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_tenantId_email_key" ON "Candidate"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Application_tenantId_stage_requisitionId_idx" ON "Application"("tenantId", "stage", "requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_requisitionId_key" ON "Application"("candidateId", "requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_key" ON "Offer"("applicationId");

-- CreateIndex
CREATE INDEX "Offer_tenantId_status_idx" ON "Offer"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OnboardingPlan_tenantId_status_targetStartDate_idx" ON "OnboardingPlan"("tenantId", "status", "targetStartDate");

-- CreateIndex
CREATE INDEX "OnboardingPlan_tenantId_personId_idx" ON "OnboardingPlan"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "OnboardingTask_tenantId_planId_status_idx" ON "OnboardingTask"("tenantId", "planId", "status");

-- CreateIndex
CREATE INDEX "WorkSchedule_tenantId_active_idx" ON "WorkSchedule"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_tenantId_code_effectiveFrom_key" ON "WorkSchedule"("tenantId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkScheduleAssignment_tenantId_scheduleId_effectiveTo_idx" ON "WorkScheduleAssignment"("tenantId", "scheduleId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleAssignment_employmentId_effectiveFrom_key" ON "WorkScheduleAssignment"("employmentId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_workDate_status_idx" ON "TimeEntry"("tenantId", "workDate", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_employmentId_workDate_idx" ON "TimeEntry"("tenantId", "employmentId", "workDate");

-- CreateIndex
CREATE INDEX "LeaveType_tenantId_active_idx" ON "LeaveType"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenantId_code_key" ON "LeaveType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "LeaveBalance_tenantId_periodYear_idx" ON "LeaveBalance"("tenantId", "periodYear");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employmentId_leaveTypeId_periodYear_key" ON "LeaveBalance"("employmentId", "leaveTypeId", "periodYear");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_status_startsAt_idx" ON "LeaveRequest"("tenantId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_employmentId_startsAt_idx" ON "LeaveRequest"("tenantId", "employmentId", "startsAt");

-- CreateIndex
CREATE INDEX "CompensationChange_tenantId_status_effectiveAt_idx" ON "CompensationChange"("tenantId", "status", "effectiveAt");

-- CreateIndex
CREATE INDEX "CompensationChange_tenantId_employmentId_effectiveAt_idx" ON "CompensationChange"("tenantId", "employmentId", "effectiveAt");

-- CreateIndex
CREATE INDEX "PayrollCountryPack_tenantId_active_idx" ON "PayrollCountryPack"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCountryPack_tenantId_countryCode_version_key" ON "PayrollCountryPack"("tenantId", "countryCode", "version");

-- CreateIndex
CREATE INDEX "PayrollPeriod_tenantId_status_payDate_idx" ON "PayrollPeriod"("tenantId", "status", "payDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_tenantId_countryPackId_code_key" ON "PayrollPeriod"("tenantId", "countryPackId", "code");

-- CreateIndex
CREATE INDEX "PayrollRun_tenantId_status_startedAt_idx" ON "PayrollRun"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_payrollPeriodId_runNumber_key" ON "PayrollRun"("payrollPeriodId", "runNumber");

-- CreateIndex
CREATE INDEX "PayrollResult_tenantId_employmentId_calculatedAt_idx" ON "PayrollResult"("tenantId", "employmentId", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollResult_payrollRunId_employmentId_key" ON "PayrollResult"("payrollRunId", "employmentId");

-- CreateIndex
CREATE INDEX "PayrollLineItem_tenantId_payrollResultId_type_idx" ON "PayrollLineItem"("tenantId", "payrollResultId", "type");

-- CreateIndex
CREATE INDEX "EmployeeCase_tenantId_ownerUserId_status_idx" ON "EmployeeCase"("tenantId", "ownerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeCase_tenantId_caseNumber_key" ON "EmployeeCase"("tenantId", "caseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CaseAssignment_caseId_userId_key" ON "CaseAssignment"("caseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRecord_objectKey_key" ON "DocumentRecord"("objectKey");

-- CreateIndex
CREATE INDEX "DocumentRecord_tenantId_personId_status_idx" ON "DocumentRecord"("tenantId", "personId", "status");

-- CreateIndex
CREATE INDEX "DocumentRecord_tenantId_caseId_idx" ON "DocumentRecord"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "EmployeeLifecycleEvent_tenantId_personId_effectiveAt_idx" ON "EmployeeLifecycleEvent"("tenantId", "personId", "effectiveAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_occurredAt_idx" ON "AuditEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_resourceType_resourceId_idx" ON "AuditEvent"("tenantId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "CaseParticipant_tenantId_caseId_role_idx" ON "CaseParticipant"("tenantId", "caseId", "role");

-- CreateIndex
CREATE INDEX "CaseParticipant_tenantId_personId_idx" ON "CaseParticipant"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "CaseAllegation_tenantId_caseId_status_idx" ON "CaseAllegation"("tenantId", "caseId", "status");

-- CreateIndex
CREATE INDEX "CaseAllegation_tenantId_category_status_idx" ON "CaseAllegation"("tenantId", "category", "status");

-- CreateIndex
CREATE INDEX "CaseInterview_tenantId_caseId_scheduledAt_idx" ON "CaseInterview"("tenantId", "caseId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CaseEvidence_tenantId_caseId_collectedAt_idx" ON "CaseEvidence"("tenantId", "caseId", "collectedAt");

-- CreateIndex
CREATE INDEX "CaseFinding_tenantId_caseId_decidedAt_idx" ON "CaseFinding"("tenantId", "caseId", "decidedAt");

-- CreateIndex
CREATE INDEX "CaseAction_tenantId_caseId_status_idx" ON "CaseAction"("tenantId", "caseId", "status");

-- CreateIndex
CREATE INDEX "CaseAction_tenantId_ownerId_dueAt_idx" ON "CaseAction"("tenantId", "ownerId", "dueAt");

-- CreateIndex
CREATE INDEX "CaseAppeal_tenantId_caseId_status_idx" ON "CaseAppeal"("tenantId", "caseId", "status");

-- CreateIndex
CREATE INDEX "HRServiceRequest_tenantId_status_priority_idx" ON "HRServiceRequest"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "HRServiceRequest_tenantId_requestorId_createdAt_idx" ON "HRServiceRequest"("tenantId", "requestorId", "createdAt");

-- CreateIndex
CREATE INDEX "HRServiceRequest_tenantId_assigneeId_slaDueAt_idx" ON "HRServiceRequest"("tenantId", "assigneeId", "slaDueAt");

-- CreateIndex
CREATE INDEX "HRServiceRequest_tenantId_queue_status_idx" ON "HRServiceRequest"("tenantId", "queue", "status");

-- CreateIndex
CREATE INDEX "HRServiceRequest_tenantId_escalationLevel_slaDueAt_idx" ON "HRServiceRequest"("tenantId", "escalationLevel", "slaDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "HRServiceRequest_tenantId_requestNumber_key" ON "HRServiceRequest"("tenantId", "requestNumber");

-- CreateIndex
CREATE INDEX "HRServiceComment_tenantId_requestId_createdAt_idx" ON "HRServiceComment"("tenantId", "requestId", "createdAt");

-- CreateIndex
CREATE INDEX "HRServiceQueue_tenantId_active_name_idx" ON "HRServiceQueue"("tenantId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HRServiceQueue_tenantId_key_key" ON "HRServiceQueue"("tenantId", "key");

-- CreateIndex
CREATE INDEX "HRServiceQueueMembership_tenantId_userId_role_idx" ON "HRServiceQueueMembership"("tenantId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "HRServiceQueueMembership_queueId_userId_key" ON "HRServiceQueueMembership"("queueId", "userId");

-- CreateIndex
CREATE INDEX "PolicyRecord_tenantId_status_effectiveFrom_idx" ON "PolicyRecord"("tenantId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PolicyRecord_tenantId_reviewDueAt_idx" ON "PolicyRecord"("tenantId", "reviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRecord_tenantId_code_version_key" ON "PolicyRecord"("tenantId", "code", "version");

-- CreateIndex
CREATE INDEX "PolicyAssignment_tenantId_employmentId_status_idx" ON "PolicyAssignment"("tenantId", "employmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_policyId_employmentId_key" ON "PolicyAssignment"("policyId", "employmentId");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgement_tenantId_employmentId_acknowledgedAt_idx" ON "PolicyAcknowledgement"("tenantId", "employmentId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcknowledgement_policyId_employmentId_policyVersion_key" ON "PolicyAcknowledgement"("policyId", "employmentId", "policyVersion");

-- CreateIndex
CREATE INDEX "PolicyException_tenantId_policyId_status_idx" ON "PolicyException"("tenantId", "policyId", "status");

-- CreateIndex
CREATE INDEX "PolicyException_tenantId_expiresAt_active_idx" ON "PolicyException"("tenantId", "expiresAt", "active");

-- CreateIndex
CREATE INDEX "PolicyException_tenantId_requestedById_status_idx" ON "PolicyException"("tenantId", "requestedById", "status");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_tenantId_status_key_idx" ON "WorkflowDefinition"("tenantId", "status", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_tenantId_key_version_key" ON "WorkflowDefinition"("tenantId", "key", "version");

-- CreateIndex
CREATE INDEX "WorkflowStepDefinition_tenantId_definitionId_orderIndex_idx" ON "WorkflowStepDefinition"("tenantId", "definitionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStepDefinition_definitionId_stepKey_key" ON "WorkflowStepDefinition"("definitionId", "stepKey");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_status_startedAt_idx" ON "WorkflowInstance"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_subjectType_subjectId_idx" ON "WorkflowInstance"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "WorkflowTask_tenantId_instanceId_status_idx" ON "WorkflowTask"("tenantId", "instanceId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTask_tenantId_assigneeId_dueAt_idx" ON "WorkflowTask"("tenantId", "assigneeId", "dueAt");

-- CreateIndex
CREATE INDEX "WorkflowEvent_tenantId_instanceId_occurredAt_idx" ON "WorkflowEvent"("tenantId", "instanceId", "occurredAt");

-- AddForeignKey
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_benefitPlanId_fkey" FOREIGN KEY ("benefitPlanId") REFERENCES "BenefitPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessionCandidate" ADD CONSTRAINT "SuccessionCandidate_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SuccessionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentSkill" ADD CONSTRAINT "EmploymentSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentPlan" ADD CONSTRAINT "DevelopmentPlan_sourceAssessmentId_fkey" FOREIGN KEY ("sourceAssessmentId") REFERENCES "TalentAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentPlan" ADD CONSTRAINT "DevelopmentPlan_successionCandidateId_fkey" FOREIGN KEY ("successionCandidateId") REFERENCES "SuccessionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentPlan" ADD CONSTRAINT "DevelopmentPlan_focusSkillId_fkey" FOREIGN KEY ("focusSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningAssignment" ADD CONSTRAINT "LearningAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "LearningCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningAssignment" ADD CONSTRAINT "LearningAssignment_successionCandidateId_fkey" FOREIGN KEY ("successionCandidateId") REFERENCES "SuccessionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningAssignment" ADD CONSTRAINT "LearningAssignment_developmentPlanId_fkey" FOREIGN KEY ("developmentPlanId") REFERENCES "DevelopmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningAssignment" ADD CONSTRAINT "LearningAssignment_developmentSkillId_fkey" FOREIGN KEY ("developmentSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeparationScheduleAmendment" ADD CONSTRAINT "SeparationScheduleAmendment_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeparationManagerReassignment" ADD CONSTRAINT "SeparationManagerReassignment_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeparationTask" ADD CONSTRAINT "SeparationTask_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReturn" ADD CONSTRAINT "AssetReturn_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRevocation" ADD CONSTRAINT "AccessRevocation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitInterview" ADD CONSTRAINT "ExitInterview_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeTransfer" ADD CONSTRAINT "KnowledgeTransfer_processId_fkey" FOREIGN KEY ("processId") REFERENCES "SeparationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "EngagementSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyCampaign" ADD CONSTRAINT "SurveyCampaign_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "EngagementSurvey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforcePlanLine" ADD CONSTRAINT "WorkforcePlanLine_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "WorkforceScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "MetricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureParticipant" ADD CONSTRAINT "SignatureParticipant_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccount" ADD CONSTRAINT "UserAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalIdentity" ADD CONSTRAINT "PersonalIdentity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUnit" ADD CONSTRAINT "OrganizationUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUnit" ADD CONSTRAINT "OrganizationUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_managerEmploymentId_fkey" FOREIGN KEY ("managerEmploymentId") REFERENCES "Employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationHistory" ADD CONSTRAINT "CompensationHistory_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_hiredPersonId_fkey" FOREIGN KEY ("hiredPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OnboardingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleAssignment" ADD CONSTRAINT "WorkScheduleAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleAssignment" ADD CONSTRAINT "WorkScheduleAssignment_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleAssignment" ADD CONSTRAINT "WorkScheduleAssignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationChange" ADD CONSTRAINT "CompensationChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationChange" ADD CONSTRAINT "CompensationChange_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCountryPack" ADD CONSTRAINT "PayrollCountryPack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_countryPackId_fkey" FOREIGN KEY ("countryPackId") REFERENCES "PayrollCountryPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollResult" ADD CONSTRAINT "PayrollResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollResult" ADD CONSTRAINT "PayrollResult_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollResult" ADD CONSTRAINT "PayrollResult_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "Employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLineItem" ADD CONSTRAINT "PayrollLineItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLineItem" ADD CONSTRAINT "PayrollLineItem_payrollResultId_fkey" FOREIGN KEY ("payrollResultId") REFERENCES "PayrollResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCase" ADD CONSTRAINT "EmployeeCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCase" ADD CONSTRAINT "EmployeeCase_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EmployeeCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "EmployeeCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLifecycleEvent" ADD CONSTRAINT "EmployeeLifecycleEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLifecycleEvent" ADD CONSTRAINT "EmployeeLifecycleEvent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HRServiceComment" ADD CONSTRAINT "HRServiceComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HRServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HRServiceQueueMembership" ADD CONSTRAINT "HRServiceQueueMembership_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "HRServiceQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PolicyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyException" ADD CONSTRAINT "PolicyException_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PolicyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepDefinition" ADD CONSTRAINT "WorkflowStepDefinition_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

