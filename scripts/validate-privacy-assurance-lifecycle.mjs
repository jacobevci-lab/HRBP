import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const createAssessmentPath = "app/api/privacy/assessments/route.ts";
const createAssessment = await source(createAssessmentPath);
expect(createAssessmentPath, createAssessment, /mutationOriginAllowed\(request\)/, "privacy assessment creation must enforce origin checks");
expect(createAssessmentPath, createAssessment, /can\(ctx,\s*"privacy:write"\)/, "privacy assessment creation must require privacy write authority");
expect(createAssessmentPath, createAssessment, /ownerId:\s*ctx\.actorId/, "new privacy assessments must be owner-bound");
expect(createAssessmentPath, createAssessment, /status:\s*"OPEN"/, "new privacy assessments must enter an open lifecycle");
expect(createAssessmentPath, createAssessment, /DataClassification\.RESTRICTED/, "privacy assessment creation audit evidence must remain restricted");

const assessmentEditPath = "app/api/privacy/assessments/[id]/route.ts";
const assessmentEdit = await source(assessmentEditPath);
expect(assessmentEditPath, assessmentEdit, /mutationOriginAllowed\(request\)/, "assessment metadata edits must enforce origin checks");
expect(assessmentEditPath, assessmentEdit, /current\.ownerId !== ctx\.actorId/, "assessment metadata edits must remain owner-bound");
expect(assessmentEditPath, assessmentEdit, /terminalStatuses\.has\(current\.status\.toUpperCase\(\)\)/, "terminal assessments must be reopened before metadata edits");
expect(assessmentEditPath, assessmentEdit, /processingActivity\.findFirst[\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*active:\s*true/, "assessment processing activity links must remain tenant-bound and active");
expect(assessmentEditPath, assessmentEdit, /where:\s*\{\s*id:\s*current\.id,\s*status:\s*current\.status\s*\}/, "assessment metadata edits must be concurrency protected");
expect(assessmentEditPath, assessmentEdit, /privacy-assessment\.updated/, "assessment metadata edits must be audited");
expect(assessmentEditPath, assessmentEdit, /DataClassification\.RESTRICTED/, "assessment metadata audit evidence must remain restricted");

const assessmentPath = "app/api/privacy/assessments/[id]/lifecycle/route.ts";
const assessment = await source(assessmentPath);
expect(assessmentPath, assessment, /START[\s\S]*WAIT[\s\S]*COMPLETE[\s\S]*REOPEN/, "assessment lifecycle must support start, wait, complete and reopen");
expect(assessmentPath, assessment, /current\.ownerId !== ctx\.actorId/, "assessment lifecycle must remain owner-bound");
expect(assessmentPath, assessment, /terminalStatuses/, "assessment lifecycle must explicitly preserve terminal states");
expect(assessmentPath, assessment, /status:\s*"IN_PROGRESS"/, "assessment lifecycle must support in-progress state");
expect(assessmentPath, assessment, /status:\s*"WAITING"/, "assessment lifecycle must support waiting state");
expect(assessmentPath, assessment, /status:\s*"COMPLETED"/, "assessment lifecycle must support completion");
expect(assessmentPath, assessment, /findings:\s*\{[\s\S]*summary,[\s\S]*mitigations:/, "assessment completion must preserve bounded findings");
expect(assessmentPath, assessment, /where:\s*\{\s*id:\s*current\.id,\s*status:\s*current\.status\s*\}/, "assessment lifecycle updates must be concurrency protected");
expect(assessmentPath, assessment, /P2025/, "assessment concurrency conflicts must fail closed");
expect(assessmentPath, assessment, /DataClassification\.RESTRICTED/, "assessment lifecycle audit evidence must remain restricted");

const createTransferPath = "app/api/privacy/transfers/route.ts";
const createTransfer = await source(createTransferPath);
expect(createTransferPath, createTransfer, /Object\.values\(TransferMechanism\)/, "transfer mechanism must be enum validated");
expect(createTransferPath, createTransfer, /dataCategories/, "transfer creation must require bounded data categories");
expect(createTransferPath, createTransfer, /active:\s*true/, "new transfer register entries must start active");
expect(createTransferPath, createTransfer, /DataClassification\.RESTRICTED/, "transfer creation audit evidence must remain restricted");

const transferPath = "app/api/privacy/transfers/[id]/lifecycle/route.ts";
const transfer = await source(transferPath);
expect(transferPath, transfer, /SCHEDULE_REVIEW[\s\S]*COMPLETE_REVIEW[\s\S]*DEACTIVATE[\s\S]*REACTIVATE/, "transfer lifecycle must support review scheduling, completion and activation state");
expect(transferPath, transfer, /future nextDueAt/, "review scheduling/reactivation must require a future due date");
expect(transferPath, transfer, /transferImpactDueAt:\s*nextDueAt \?\? null/, "completed TIA review must clear or reschedule the next due date");
expect(transferPath, transfer, /active:\s*false/, "transfer lifecycle must support deactivation");
expect(transferPath, transfer, /active:\s*true,\s*transferImpactDueAt:\s*nextDueAt/, "reactivation must restore active state with a review due date");
expect(transferPath, transfer, /where:\s*\{\s*id:\s*current\.id,\s*active:\s*current\.active\s*\}/, "transfer lifecycle updates must be concurrency protected");
expect(transferPath, transfer, /P2025/, "transfer concurrency conflicts must fail closed");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /dataTransferRegister\.findMany\(\{ where: \{ tenantId: ctx\.tenantId \}/, "Privacy workspace must keep the complete transfer register visible");
expect(dataPath, data, /activeTransfers:\s*transfers\.filter\(\(transfer\) => transfer\.active\)\.length/, "Privacy metrics must count only active transfers");
expect(dataPath, data, /active:\s*transfer\.active/, "transfer rows must preserve activation state for lifecycle controls");
expect(dataPath, data, /processingActivityId:\s*assessment\.processingActivityId/, "assessment rows must preserve their processing activity link for connected assurance UX");
reject(dataPath, data, /findings:\s*assessment\.findings/, "default Privacy workspace must not project restricted assessment findings");

const uiPath = "components/privacy-assurance-actions.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/api\/privacy\/assessments/, "Privacy workspace must create assessments through governed API");
expect(uiPath, ui, /\/lifecycle/, "Privacy assurance UI must invoke governed lifecycle routes");
expect(uiPath, ui, /Findings summary/, "assessment completion must require human findings");
expect(uiPath, ui, /Processing activity/, "privacy assessment authoring must expose the connected processing activity");
expect(uiPath, ui, /Save metadata/, "non-terminal owned assessments must expose governed metadata edits");
expect(uiPath, ui, /SCHEDULE_REVIEW/, "transfer UI must expose TIA review scheduling");
expect(uiPath, ui, /COMPLETE_REVIEW/, "transfer UI must expose TIA review completion");
expect(uiPath, ui, /DEACTIVATE/, "transfer UI must expose deactivation");
expect(uiPath, ui, /REACTIVATE/, "transfer UI must expose reactivation");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /PrivacyAssessmentCreateForm[\s\S]*activities=\{data\.activities\.map/, "assessment creation must receive active processing activity options from the Privacy workspace");
expect(workspacePath, workspace, /PrivacyAssessmentActions/, "assessment lifecycle must be mounted in Privacy workspace");
expect(workspacePath, workspace, /PrivacyTransferCreateForm/, "transfer creation must be mounted in Privacy workspace");
expect(workspacePath, workspace, /PrivacyTransferActions/, "transfer lifecycle must be mounted in Privacy workspace");

const continuityPath = "lib/privacy-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /active:\s*true/, "central TIA attention must continue to include only active transfers");
expect(continuityPath, continuity, /completedAt:\s*null/, "completed assessments must leave active Privacy attention");
expect(continuityPath, continuity, /type:\s*"start-privacy-assessment"/, "privacy assessment attention must expose start action");
expect(continuityPath, continuity, /type:\s*"wait-privacy-assessment"/, "privacy assessment attention must expose wait action");
expect(continuityPath, continuity, /type:\s*"resume-privacy-assessment"/, "privacy assessment attention must expose resume action");
reject(continuityPath, continuity, /findings|dataCategories|specialCategories/, "central Privacy attention must not receive restricted assurance content");

const actionCenterPath = "components/workflow-action-center.tsx";
const actionCenter = await source(actionCenterPath);
expect(actionCenterPath, actionCenter, /item\.action\.type === "start-privacy-assessment"[\s\S]*\/api\/privacy\/assessments\//, "privacy assessment start must use the governed lifecycle route");
expect(actionCenterPath, actionCenter, /item\.action\.type === "wait-privacy-assessment"[\s\S]*action:\s*"WAIT"/, "privacy assessment waiting must use the governed lifecycle route");
expect(actionCenterPath, actionCenter, /item\.action\.type === "resume-privacy-assessment"[\s\S]*action:\s*"START"/, "privacy assessment resume must reuse the governed START transition");
expect(actionCenterPath, actionCenter, /resourceType:\s*"PrivacyRiskAssessment"/, "privacy assessment quick actions must clear matching notifications best-effort");
expect(actionCenterPath, actionCenter, /window\.confirm\(copy\.confirm\)/, "privacy assessment quick actions must require explicit confirmation");
reject(actionCenterPath, actionCenter, /item\.action\.type === "complete-privacy-assessment"|\/api\/privacy\/assessments\/[\s\S]{0,500}payload = \{ action: "COMPLETE" \}/, "privacy assessment completion requiring findings must remain in the owning Privacy workspace");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /privacy-assurance-lifecycle:validate/, "privacy assurance lifecycle validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*privacy-assurance-lifecycle:validate/, "privacy assurance lifecycle validation must run before production builds");

if (failures.length) {
  console.error("Privacy assurance lifecycle validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Privacy assurance lifecycle validation passed.");
