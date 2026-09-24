import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /"compensation:propose"/, "compensation proposal must have a dedicated capability");
expect(authPath, auth, /"compensation:approve"/, "compensation approval must have a dedicated capability");
expect(authPath, auth, /"compensation:apply"/, "compensation application must have a dedicated capability");
expect(authPath, auth, /HRBP:[\s\S]*"compensation:read"[\s\S]*"compensation:propose"/, "HRBP must be able to propose scoped compensation without receiving approval power");
const hrbpGrant = auth.match(/HRBP:\s*\[[\s\S]*?\],\n\s*HR_OPERATIONS:/)?.[0] ?? "";
expectAbsent(authPath, hrbpGrant, /"compensation:approve"|"compensation:apply"/, "HRBP must not receive compensation approval or apply capability");
expect(authPath, auth, /COMPENSATION_ADMIN:[\s\S]*"compensation:propose"[\s\S]*"compensation:approve"[\s\S]*"compensation:apply"/, "compensation administrators must receive separated proposal, approval and apply capabilities");

const createPath = "app/api/compensation/changes/route.ts";
const create = await source(createPath);
expect(createPath, create, /can\(ctx,\s*"compensation:propose"\)/, "new compensation proposals must require proposal capability");
expect(createPath, create, /compensationHistory\.findFirst/, "proposal creation must resolve the governed salary baseline server-side");
expect(createPath, create, /currentAnnualBase:\s*baseline\?\.annualBase\s*\?\?\s*null/, "browser-supplied current salary must not become the proposal baseline");
expectAbsent(createPath, create, /body\.currentAnnualBase/, "current salary must never be accepted from the request body");
expect(createPath, create, /OPEN_CHANGE_CONFLICT/, "duplicate open changes for the same effective date must be rejected");
expect(createPath, create, /NO_OP_CHANGE/, "no-op compensation proposals must be rejected");
expect(createPath, create, /TransactionIsolationLevel\.Serializable/, "proposal creation must use serializable isolation");

const submitPath = "app/api/compensation/changes/[id]/submit/route.ts";
const submit = await source(submitPath);
expect(submitPath, submit, /requestedById\s*!==\s*ctx\.actorId/, "only the original requester may submit a draft");
expect(submitPath, submit, /CompensationChangeStatus\.DRAFT[\s\S]*CompensationChangeStatus\.APPROVAL/, "draft submission must be an explicit state transition");
expect(submitPath, submit, /enqueueCompensationApprovalNotification/, "submitted compensation must notify independent compensation approvers");
expect(submitPath, submit, /COMPENSATION_CHANGE_SUBMITTED/, "draft submission must emit explicit audit evidence");

const decisionPath = "app/api/compensation/changes/[id]/decision/route.ts";
const decision = await source(decisionPath);
expect(decisionPath, decision, /decision\s*===\s*"APPLY"[\s\S]*"compensation:apply"/, "application must require its own capability");
expect(decisionPath, decision, /"compensation:approve"/, "approve and reject must require approval capability");
expect(decisionPath, decision, /requestedById\s*===\s*ctx\.actorId/, "requester must be blocked from approving or rejecting their own proposal");
expect(decisionPath, decision, /enqueueCompensationDecisionNotification/, "approval result must notify the original requester");
expect(decisionPath, decision, /applyApprovedCompensationChange/, "application must use the shared governed effective-dating service");
expect(decisionPath, decision, /TransactionIsolationLevel\.Serializable/, "compensation decisions must use serializable isolation");

const applyPath = "lib/compensation-application.ts";
const apply = await source(applyPath);
expect(applyPath, apply, /change\.requestedById\s*===\s*ctx\.actorId/, "requester must not apply their own change");
expect(applyPath, apply, /BASELINE_CHANGED/, "approved changes must be revalidated against the governed salary baseline before apply");
expect(applyPath, apply, /nextHistory/, "effective-dated application must preserve a future salary record boundary");
expect(applyPath, apply, /effectiveTo:\s*new Date\(change\.effectiveAt\.getTime\(\) - 1\)/, "the prior governed salary record must close immediately before the new effective date");
expect(applyPath, apply, /effectiveTo:\s*nextHistory\s*\?\s*new Date\(nextHistory\.effectiveFrom\.getTime\(\) - 1\)\s*:\s*null/, "new salary history must stop before a later scheduled salary record");
expect(applyPath, apply, /updateMany/, "apply must reserve the approved state with a state-aware write");
expect(applyPath, apply, /enqueueCompensationPayrollHandoffNotification/, "applied compensation must emit a payroll handoff event");
expect(applyPath, apply, /COMPENSATION_CHANGE_APPLIED/, "applied compensation must emit restricted audit evidence");

const legacyApplyPath = "app/api/compensation/changes/[id]/apply/route.ts";
const legacyApply = await source(legacyApplyPath);
expect(legacyApplyPath, legacyApply, /can\(ctx,\s*"compensation:apply"\)/, "legacy apply endpoint must not bypass granular apply authority");
expect(legacyApplyPath, legacyApply, /applyApprovedCompensationChange/, "legacy apply endpoint must use the shared governed application path");

const notificationPath = "lib/compensation-notifications.ts";
const notifications = await source(notificationPath);
expect(notificationPath, notifications, /COMPENSATION_APPROVAL_REQUIRED/, "compensation submission must have a dedicated approval notification");
expect(notificationPath, notifications, /recipientRole:\s*"COMPENSATION_ADMIN"/, "approval notification must target the compensation administration role");
expect(notificationPath, notifications, /COMPENSATION_CHANGE_APPROVED[\s\S]*COMPENSATION_CHANGE_REJECTED/, "requester must receive compensation decision notifications");
expect(notificationPath, notifications, /COMPENSATION_PAYROLL_HANDOFF_READY/, "payroll handoff must use a dedicated notification event");
expect(notificationPath, notifications, /recipientRole:\s*"PAYROLL_ADMIN"/, "payroll handoff must target payroll administration");
expect(notificationPath, notifications, /DataClassification\.RESTRICTED/, "compensation notification payloads must remain restricted");

const dataPath = "lib/compensation-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /eligibleEmployments/, "compensation workspace must expose scoped proposal targets");
expect(dataPath, data, /employmentPrimaryKeyFilter\(scope\)/, "proposal targets must remain relationship scoped");
expect(dataPath, data, /compensation:\s*\{[\s\S]*effectiveFrom:[\s\S]*effectiveTo:/, "proposal UI must show the governed current salary record");

const createConsolePath = "components/compensation-create-console.tsx";
const createConsole = await source(createConsolePath);
expect(createConsolePath, createConsole, /\/api\/compensation\/changes/, "proposal console must write through the governed compensation API");
expect(createConsolePath, createConsole, /The salary baseline is resolved again on the server/, "proposal UI must disclose server-side salary baseline authority");
expectAbsent(createConsolePath, createConsole, /currentAnnualBase:\s*values\.get/, "proposal UI must not submit current salary as an authoritative input");

const decisionConsolePath = "components/compensation-decision-buttons.tsx";
const decisionConsole = await source(decisionConsolePath);
expect(decisionConsolePath, decisionConsole, /\/submit/, "drafts must have an explicit submit action");
expect(decisionConsolePath, decisionConsole, /canApprove[\s\S]*!isRequester/, "approval controls must hide self-approval actions");
expect(decisionConsolePath, decisionConsole, /canApply[\s\S]*!isRequester/, "apply controls must hide requester application actions");

const workspacePath = "components/compensation-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /can\(ctx,\s*"compensation:propose"\)/, "workspace proposal console must be capability gated");
expect(workspacePath, workspace, /can\(ctx,\s*"compensation:approve"\)/, "workspace approval controls must be capability gated");
expect(workspacePath, workspace, /can\(ctx,\s*"compensation:apply"\)/, "workspace application controls must be capability gated");
expect(workspacePath, workspace, /CompensationCreateConsole/, "workspace must expose a governed compensation draft console");

if (failures.length) {
  console.error("Compensation governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated compensation governance contract: scoped proposals, server-owned salary baselines, explicit submission, four-eyes approval, effective-dated history integrity and payroll handoff are enforced.");
