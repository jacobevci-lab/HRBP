import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /"recruiting:approve"/, "recruiting approval must have a dedicated capability");
const recruiterGrant = auth.match(/RECRUITER:\s*\[[\s\S]*?\],\n\s*TIME_ADMIN:/)?.[0] ?? "";
expectAbsent(authPath, recruiterGrant, /"recruiting:approve"/, "recruiter preparation authority must not imply recruiting approval");
expect(authPath, auth, /HRBP:[\s\S]*"recruiting:approve"/, "HRBP must be able to perform independent recruiting decisions");
expect(authPath, auth, /HR_OPERATIONS:[\s\S]*"recruiting:approve"/, "HR operations must be able to perform independent recruiting decisions");

const accessPath = "lib/recruiting-access.ts";
const access = await source(accessPath);
expect(accessPath, access, /hasTenantRecruitingVisibility[\s\S]*recruiting:write/, "tenant-wide recruiting visibility must require recruiting write authority");
expect(accessPath, access, /hiringManagerId:\s*ctx\.actorId/, "read-only recruiting users must be restricted to requisitions they own");
expect(accessPath, access, /applications:\s*\{\s*some:[\s\S]*hiringManagerId:\s*ctx\.actorId/, "candidate visibility must derive from an owned requisition");

const livePath = "lib/recruiting-live-data.ts";
const live = await source(livePath);
expect(livePath, live, /getRecruitingWorkspaceData\(ctx:\s*RequestContext\)/, "recruiting live data must receive the signed request context");
expect(livePath, live, /recruitingRequisitionReadFilter\(ctx\)/, "requisition metrics and rows must use recruiting access scope");
expect(livePath, live, /recruitingApplicationReadFilter\(ctx\)/, "candidate pipeline must use recruiting access scope");
expect(livePath, live, /requisitionId:\s*\{\s*in:\s*requisitionIds\s*\}/, "applications must be pinned to already-authorized requisitions");
expect(livePath, live, /id:\s*\{\s*in:\s*userIds\s*\}/, "recruiting user names must only load identities referenced by visible requisitions");
expectAbsent(livePath, live, /workspaceTenantId/, "authenticated recruiting live data must not rely on a workspace-wide tenant fallback");
expect(livePath, live, /resolveOnboardingPopulationScope\(db,\s*ctx\)/, "onboarding live data must resolve employment population scope");
expect(livePath, live, /onboardingPlanPopulationFilter\(scope\)/, "onboarding plans must apply the same population filter as onboarding APIs");
expect(livePath, live, /id:\s*\{\s*in:\s*ownerIds\s*\}/, "onboarding owner identities must be limited to visible plans");

const recruitingOpsPath = "lib/recruiting-operations-data.ts";
const recruitingOps = await source(recruitingOpsPath);
expect(recruitingOpsPath, recruitingOps, /ACTIVE_REQUISITION_STATUSES[\s\S]*RequisitionStatus\.DRAFT[\s\S]*RequisitionStatus\.APPROVAL[\s\S]*RequisitionStatus\.OPEN[\s\S]*RequisitionStatus\.ON_HOLD/, "recruiting operations must share one definition of active requisition ownership");
expect(recruitingOpsPath, recruitingOps, /requisitions:\s*\{\s*none:\s*\{\s*status:\s*\{\s*in:\s*ACTIVE_REQUISITION_STATUSES/, "new requisitions must only offer positions not already owned by another active requisition");
expect(recruitingOpsPath, recruitingOps, /RECRUITING_ASSIGNABLE_ROLES[\s\S]*PlatformRole\.MANAGER[\s\S]*PlatformRole\.RECRUITER[\s\S]*PlatformRole\.HRBP[\s\S]*PlatformRole\.HR_OPERATIONS/, "recruiting user selectors must be limited to operationally relevant roles");
expect(recruitingOpsPath, recruitingOps, /role:\s*\{\s*in:\s*RECRUITING_ASSIGNABLE_ROLES\s*\}/, "recruiting operations must not expose all active tenant identities in assignment selectors");

const onboardingOpsPath = "lib/onboarding-operations-data.ts";
const onboardingOps = await source(onboardingOpsPath);
expect(onboardingOpsPath, onboardingOps, /getOnboardingOperationsData\(ctx:\s*RequestContext\)/, "onboarding operations must receive request context");
expect(onboardingOpsPath, onboardingOps, /resolveOnboardingPopulationScope\(db,\s*ctx\)/, "onboarding operations must resolve employment scope");
expect(onboardingOpsPath, onboardingOps, /onboardingPlanPopulationFilter\(scope\)/, "onboarding operations must filter visible plans before exposing tasks");

const workspacePath = "components/recruiting-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /getRecruitingWorkspaceData\(ctx\)/, "recruiting workspace must pass signed request context to live data");
expect(workspacePath, workspace, /getOnboardingWorkspaceData\(ctx\)/, "onboarding workspace must pass signed request context to live data");
expect(workspacePath, workspace, /getOnboardingOperationsData\(ctx\)/, "onboarding operations console must use the same signed scope");
expectAbsent(workspacePath, workspace, /getRecruitingWorkspaceData\(ctx\.tenantId\)|getOnboardingWorkspaceData\(ctx\.tenantId\)|getOnboardingOperationsData\(ctx\.tenantId\)/, "live read helpers must never be called with tenant id alone");
expect(workspacePath, workspace, /canApprove=\{can\(ctx,\s*"recruiting:approve"\)\}/, "recruiting operations UI must receive explicit approval authority");
expect(workspacePath, workspace, /return\s*<ProtectedLiveFailure\s+domain=\{c\(locale,"Recruiting","İşe Alım"\)\}/, "authenticated recruiting failures must not substitute synthetic demo data");
expect(workspacePath, workspace, /return\s*<ProtectedLiveFailure\s+domain=\{c\(locale,"Onboarding","İşe Başlatma"\)\}/, "authenticated onboarding failures must not substitute synthetic demo data");
expectAbsent(workspacePath, workspace, /Promise\.all\(\[[\s\S]*getRecruitingWorkspaceData\(ctx\)[\s\S]*getRecruitingOperationsData/, "recruiting primary read data must not share a failure boundary with the write console");
expectAbsent(workspacePath, workspace, /Promise\.all\(\[[\s\S]*getOnboardingWorkspaceData\(ctx\)[\s\S]*getOnboardingOperationsData/, "onboarding primary read data must not share a failure boundary with the write console");
expect(workspacePath, workspace, /data\s*=\s*await getRecruitingWorkspaceData\(ctx\)/, "recruiting live read data must initialize independently before optional operations data");
expect(workspacePath, workspace, /data\s*=\s*await getOnboardingWorkspaceData\(ctx\)/, "onboarding live read data must initialize independently before optional operations data");
expect(workspacePath, workspace, /Recruiting operations data failed; live read view remains available/, "recruiting operations failure must preserve the authenticated live read view");
expect(workspacePath, workspace, /Onboarding operations data failed; live read view remains available/, "onboarding operations failure must preserve the authenticated live read view");
expect(workspacePath, workspace, /operationsUnavailable\s*\?\s*<OperationsUnavailableNotice\s+domain=\{c\(locale,"Recruiting","İşe Alım"\)\}/, "recruiting must surface a read-only warning when write-console data is unavailable");
expect(workspacePath, workspace, /operationsUnavailable\s*\?\s*<OperationsUnavailableNotice\s+domain=\{c\(locale,"Onboarding","İşe Başlatma"\)\}/, "onboarding must surface a read-only warning when write-console data is unavailable");

const approvalApiPath = "app/api/recruiting/approvals/route.ts";
const approvalApi = await source(approvalApiPath);
expect(approvalApiPath, approvalApi, /can\(ctx,\s*"recruiting:write"\)/, "approval queue visibility must require recruiting operations authority");
expect(approvalApiPath, approvalApi, /status:\s*RequisitionStatus\.APPROVAL/, "approval queue must include requisitions awaiting decision");
expect(approvalApiPath, approvalApi, /status:\s*OfferStatus\.APPROVAL/, "approval queue must include offers awaiting decision");
expect(approvalApiPath, approvalApi, /REQUISITION_CREATED[\s\S]*OFFER_CREATED/, "approval queue must derive preparer identity from immutable audit events");
expect(approvalApiPath, approvalApi, /selfPrepared:\s*creator\?\.actorId\s*===\s*ctx\.actorId/, "approval queue must identify decisions prepared by the current actor");
expect(approvalApiPath, approvalApi, /queue\.sort\([\s\S]*submittedAt/, "approval queue must prioritize older submitted decisions first");

const opsPath = "components/recruiting-operations-console.tsx";
const ops = await source(opsPath);
expect(opsPath, ops, /canApprove:\s*boolean/, "recruiting console must model approval access explicitly");
expect(opsPath, ops, /fetch\("\/api\/recruiting\/approvals"/, "recruiting console must load the governed approval queue");
expect(opsPath, ops, /if\s*\(item\.selfPrepared\)[\s\S]*four-eyes control requires another approver/, "the preparer must never receive approval actions for their own queue item");
expect(opsPath, ops, /if\s*\(!canApprove\)[\s\S]*Independent approver required/, "users without approval authority must not receive queue decision actions");
expect(opsPath, ops, /requisition\.status\s*===\s*"APPROVAL"\s*\?\s*\[\]/, "requisition approval decisions must be centralized in the approval queue");
expect(opsPath, ops, /application\.offer\.status\s*===\s*"APPROVAL"\s*\?\s*\[\]/, "offer approval decisions must be centralized in the approval queue");
expect(opsPath, ops, /offerLocksApplication\.has\(application\.offer\.status\)/, "application stage actions must be hidden while approval, sent or accepted offer state owns the lifecycle");
expect(opsPath, ops, /setApprovalRefreshToken\(\(value\)\s*=>\s*value\s*\+\s*1\)/, "approval queue must refresh after governed mutations");

const requisitionApiPath = "app/api/recruiting/requisitions/route.ts";
const requisitionApi = await source(requisitionApiPath);
expect(requisitionApiPath, requisitionApi, /where:\s*recruitingRequisitionReadFilter\(ctx\)/, "requisition API GET must enforce manager ownership scope");

const requisitionStatusPath = "app/api/recruiting/requisitions/[id]/status/route.ts";
const requisitionStatus = await source(requisitionStatusPath);
expect(requisitionStatusPath, requisitionStatus, /requiresApprovalAuthority[\s\S]*RequisitionStatus\.APPROVAL[\s\S]*RequisitionStatus\.OPEN/, "requisition approval decisions must be identified explicitly");
expect(requisitionStatusPath, requisitionStatus, /can\(ctx,\s*"recruiting:approve"\)/, "opening an approval-stage requisition must require recruiting approval authority");
expect(requisitionStatusPath, requisitionStatus, /creatorAudit\?\.actorId\s*===\s*ctx\.actorId/, "requisition creator must not approve and open the same requisition");
expect(requisitionStatusPath, requisitionStatus, /HIRING_MANAGER_REQUIRED/, "approved requisitions must have an accountable hiring manager before opening");
expect(requisitionStatusPath, requisitionStatus, /TransactionIsolationLevel\.Serializable/, "requisition lifecycle decisions must use serializable isolation");
expect(requisitionStatusPath, requisitionStatus, /enqueueRequisitionApprovalNotification/, "requisition approval requests must create durable notification intent");
expect(requisitionStatusPath, requisitionStatus, /enqueueRequisitionDecisionNotification/, "requisition approval decisions must notify the creator");

const candidateApiPath = "app/api/recruiting/candidates/route.ts";
const candidateApi = await source(candidateApiPath);
expect(candidateApiPath, candidateApi, /where:\s*recruitingCandidateReadFilter\(ctx\)/, "candidate API GET must filter candidate identities by recruiting scope");
expect(candidateApiPath, candidateApi, /applications:\s*\{[\s\S]*where:\s*recruitingApplicationRelationFilter\(ctx\)/, "nested candidate applications must not disclose other requisitions");
expect(candidateApiPath, candidateApi, /const\s+privileged\s*=\s*hasTenantRecruitingVisibility\(ctx\)/, "candidate personal-data expansion must derive from tenant recruiting authority");
expect(candidateApiPath, candidateApi, /\.\.\.\(privileged\s*\?\s*\{\s*email:\s*true,\s*retentionUntil:\s*true\s*\}\s*:\s*\{\}\)/, "candidate email and retention metadata must be omitted from read-only manager responses");

const offerStatusPath = "app/api/recruiting/offers/[id]/status/route.ts";
const offerStatus = await source(offerStatusPath);
expect(offerStatusPath, offerStatus, /requiresApprovalAuthority[\s\S]*OfferStatus\.APPROVAL[\s\S]*OfferStatus\.SENT/, "offer approval decisions must be identified explicitly");
expect(offerStatusPath, offerStatus, /can\(ctx,\s*"recruiting:approve"\)/, "sending an approval-stage offer must require recruiting approval authority");
expect(offerStatusPath, offerStatus, /creatorAudit\?\.actorId\s*===\s*ctx\.actorId/, "offer creator must not approve and send the same offer");
expect(offerStatusPath, offerStatus, /TransactionIsolationLevel\.Serializable/, "offer approval decisions must use serializable isolation");
expect(offerStatusPath, offerStatus, /enqueueOfferApprovalNotification/, "offer approval requests must create durable notification intent");
expect(offerStatusPath, offerStatus, /enqueueOfferDecisionNotification/, "offer approval decisions must notify the offer creator");

const notificationsPath = "lib/recruiting-notifications.ts";
const notifications = await source(notificationsPath);
expect(notificationsPath, notifications, /RECRUITING_REQUISITION_APPROVAL_REQUIRED/, "requisition approval must have a dedicated notification event");
expect(notificationsPath, notifications, /RECRUITING_OFFER_APPROVAL_REQUIRED/, "offer approval must have a dedicated notification event");
expect(notificationsPath, notifications, /recipientRole:\s*"HR_OPERATIONS"/, "independent recruiting approval notifications must route to an HR operations decision queue");
expect(notificationsPath, notifications, /recipientUserId:\s*input\.recipientUserId/, "approval results must return to the creating user");
expect(notificationsPath, notifications, /DataClassification\.RESTRICTED/, "offer notification payloads must remain restricted");
expect(notificationsPath, notifications, /dedupeKey:/, "recruiting notifications must be idempotent through dedupe keys");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /RECRUITING_REQUISITION_APPROVAL_REQUIRED:[\s\S]*İşe alım talebi onayı gerekiyor/, "recruiting requisition approvals must have localized notification titles");
expect(presentationPath, presentation, /RECRUITING_OFFER_APPROVAL_REQUIRED:[\s\S]*Teklif onayı gerekiyor/, "recruiting offer approvals must have localized notification titles");
expect(presentationPath, presentation, /RECRUITING_OFFER_EXPIRED:[\s\S]*Teklifin süresi doldu/, "expired offers must have a localized notification title");
expect(presentationPath, presentation, /const recruitingRecordType = text\(data\.recruitingRecordType\)/, "notification summaries must recognize recruiting record metadata");
expect(presentationPath, presentation, /const recruitingDecision = text\(data\.recruitingDecision\)/, "notification summaries must render recruiting decision outcomes");
expect(presentationPath, presentation, /resourceType === "Requisition"[\s\S]*\/module\/recruiting\?requisition=/, "requisition notifications must navigate back to recruiting");
expect(presentationPath, presentation, /resourceType === "Offer"[\s\S]*\/module\/recruiting\?offer=/, "offer notifications must navigate back to recruiting");
expect(presentationPath, presentation, /resourceType === "Candidate"[\s\S]*\/module\/recruiting\?candidate=/, "candidate notifications must navigate back to recruiting");
expect(presentationPath, presentation, /resourceType === "Application"[\s\S]*\/module\/recruiting\?application=/, "application notifications must navigate back to recruiting");

if (failures.length) {
  console.error("Recruiting/onboarding access contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated recruiting/onboarding governance contract: manager candidate visibility is requisition-owned, recruiting assignment selectors are minimized, positions cannot be reused across active requisitions, read-only candidate personal data is minimized, onboarding reads and operations are employment-scoped, primary live reads are isolated from optional write-console failures, authenticated failures remain protected, requisition and offer approvals are centralized, preparers are four-eyes locked from their own decisions, application actions respect active-offer ownership, approval workflows emit durable notification intent, and recruiting notifications are localized and deep-linked.");
