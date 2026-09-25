import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const readinessPath = "lib/offboarding-readiness.ts";
const readiness = await source(readinessPath);
expect(readinessPath, readiness, /terminalAssetReturnStatuses[\s\S]*RETURNED[\s\S]*WRITTEN_OFF/, "asset terminal states must be centralized");
expect(readinessPath, readiness, /terminalAccessRevocationStatuses[\s\S]*REVOKED[\s\S]*EXCEPTION/, "access terminal states must be centralized");
expect(readinessPath, readiness, /terminalKnowledgeTransferStatuses[\s\S]*COMPLETED[\s\S]*WAIVED/, "knowledge-transfer terminal states must be centralized");
expect(readinessPath, readiness, /knowledgeTransfer\.count/, "readiness must count open knowledge-transfer items");
expect(readinessPath, readiness, /knowledgeTransfersOpen\s*===\s*0/, "knowledge transfer must be a hard close-readiness gate");
expect(readinessPath, readiness, /FINAL_PAY_REVIEW[\s\S]*READY_TO_CLOSE/, "readiness helper must preserve payroll review and close-ready states");
expect(readinessPath, readiness, /separationProcess\.updateMany\([\s\S]*status:\s*process\.status/, "readiness process transition must be state-aware");
expect(readinessPath, readiness, /appendAudit/, "readiness-derived process transitions must be audited");

const assetCreatePath = "app/api/offboarding/processes/[id]/assets/route.ts";
const assetCreate = await source(assetCreatePath);
expect(assetCreatePath, assetCreate, /asText\(body\.assetTag,\s*100\)/, "asset tag must be bounded");
expect(assetCreatePath, assetCreate, /asText\(body\.assetType,\s*120\)/, "asset type must be bounded");
expect(assetCreatePath, assetCreate, /recalculateSeparationReadiness/, "registering an asset must reopen/recalculate the exit gate");
expect(assetCreatePath, assetCreate, /TransactionIsolationLevel\.Serializable/, "asset registration must use serializable isolation");
expect(assetCreatePath, assetCreate, /P2002/, "duplicate asset tags must return a controlled conflict");

const assetStatusPath = "app/api/offboarding/processes/[id]/assets/[assetId]/status/route.ts";
const assetStatus = await source(assetStatusPath);
expect(assetStatusPath, assetStatus, /DAMAGED[\s\S]*LOST[\s\S]*WRITTEN_OFF/, "asset exception states must be explicit");
expect(assetStatusPath, assetStatus, /requiresReason/, "asset exception transitions must require evidence");
expect(assetStatusPath, assetStatus, /assetReturn\.updateMany\([\s\S]*status:\s*asset\.status/, "asset transitions must be state-aware");
expect(assetStatusPath, assetStatus, /verifiedById:\s*terminal\s*\?\s*ctx\.actorId/, "terminal asset custody must record human verifier");
expect(assetStatusPath, assetStatus, /recalculateSeparationReadiness/, "asset transitions must recalculate separation readiness");
expect(assetStatusPath, assetStatus, /TransactionIsolationLevel\.Serializable/, "asset transitions must use serializable isolation");

const accessCreatePath = "app/api/offboarding/processes/[id]/access/route.ts";
const accessCreate = await source(accessCreatePath);
expect(accessCreatePath, accessCreate, /asText\(body\.systemName,\s*160\)/, "access system name must be bounded");
expect(accessCreatePath, accessCreate, /accessRevocation\.findFirst/, "access registration must explicitly catch nullable-account duplicates");
expect(accessCreatePath, accessCreate, /recalculateSeparationReadiness/, "registering access must reopen/recalculate the exit gate");
expect(accessCreatePath, accessCreate, /TransactionIsolationLevel\.Serializable/, "access registration must use serializable isolation");

const accessStatusPath = "app/api/offboarding/processes/[id]/access/[accessId]/status/route.ts";
const accessStatus = await source(accessStatusPath);
expect(accessStatusPath, accessStatus, /SCHEDULED[\s\S]*REVOKED[\s\S]*EXCEPTION/, "access lifecycle must be explicit");
expect(accessStatusPath, accessStatus, /EXCEPTION[\s\S]*exceptionReason/, "access exceptions must require explicit reason");
expect(accessStatusPath, accessStatus, /SCHEDULED[\s\S]*scheduledAt/, "scheduled revocation must require a timestamp");
expect(accessStatusPath, accessStatus, /accessRevocation\.updateMany\([\s\S]*status:\s*access\.status/, "access transitions must be state-aware");
expect(accessStatusPath, accessStatus, /verifiedById:\s*terminal\s*\?\s*ctx\.actorId/, "terminal access controls must record human verifier");
expect(accessStatusPath, accessStatus, /recalculateSeparationReadiness/, "access transitions must recalculate separation readiness");
expect(accessStatusPath, accessStatus, /TransactionIsolationLevel\.Serializable/, "access transitions must use serializable isolation");

const transferCreatePath = "app/api/offboarding/processes/[id]/knowledge-transfers/route.ts";
const transferCreate = await source(transferCreatePath);
expect(transferCreatePath, transferCreate, /asText\(body\.title,\s*180\)/, "handover title must be bounded");
expect(transferCreatePath, transferCreate, /asOptionalText\(body\.description,\s*2000\)/, "handover evidence scope must be bounded");
expect(transferCreatePath, transferCreate, /recipientId\s*===\s*process\.employmentId/, "departing employment must not be its own handover recipient");
expect(transferCreatePath, transferCreate, /canActOnEmployment\(scope,\s*recipientId\)/, "handover recipient must remain relationship scoped");
expect(transferCreatePath, transferCreate, /dueAt\s*>\s*process\.lastWorkingDate/, "handover due date must not exceed last working date");
expect(transferCreatePath, transferCreate, /recalculateSeparationReadiness/, "new handover items must reopen/recalculate readiness");
expect(transferCreatePath, transferCreate, /offboarding\.knowledge-transfer-created/, "handover creation must be audited");
expect(transferCreatePath, transferCreate, /TransactionIsolationLevel\.Serializable/, "handover creation must use serializable isolation");

const transferStatusPath = "app/api/offboarding/processes/[id]/knowledge-transfers/[transferId]/status/route.ts";
const transferStatus = await source(transferStatusPath);
expect(transferStatusPath, transferStatus, /Record<ExitTaskStatus,\s*ExitTaskStatus\[\]>/, "handover must use an explicit lifecycle map");
expect(transferStatusPath, transferStatus, /IN_PROGRESS[\s\S]*COMPLETED/, "handover lifecycle must remain human-explicit");
expect(transferStatusPath, transferStatus, /knowledgeTransfer\.updateMany\([\s\S]*status:\s*transfer\.status/, "handover transitions must be state-aware");
expect(transferStatusPath, transferStatus, /recalculateSeparationReadiness/, "handover completion must recalculate readiness");
expect(transferStatusPath, transferStatus, /appendAudit/, "handover lifecycle must be audited");
expect(transferStatusPath, transferStatus, /TransactionIsolationLevel\.Serializable/, "handover lifecycle must use serializable isolation");
expectAbsent(transferStatusPath, transferStatus, /score|recommend|suitab/i, "handover lifecycle must not introduce automated employee scoring");

const taskPath = "app/api/offboarding/processes/[id]/tasks/[taskId]/complete/route.ts";
const task = await source(taskPath);
expect(taskPath, task, /recalculateSeparationReadiness/, "task lifecycle must use the same centralized readiness helper");
expectAbsent(taskPath, task, /assetReturn\.count/, "task route must not carry a duplicate readiness implementation");

const closePath = "app/api/offboarding/processes/[id]/close/route.ts";
const close = await source(closePath);
expect(closePath, close, /knowledgeTransfer\.count/, "final termination must recheck handover readiness");
expect(closePath, close, /blockingTasks\s*\|\|\s*assets\s*\|\|\s*access\s*\|\|\s*knowledgeTransfers/, "open handover must block employment termination");
expect(closePath, close, /knowledgeTransfers:\s*Number\(knowledgeTransfers\)/, "blocked close response must expose open handover count");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /assets:[\s\S]*assetTag:[\s\S]*conditionNote:/, "live offboarding data must expose asset custody controls");
expect(dataPath, data, /accessControls:[\s\S]*systemName:[\s\S]*exceptionReason:/, "live offboarding data must expose access revocation controls");
expect(dataPath, data, /knowledgeTransfers:[\s\S]*recipientId:[\s\S]*completedAt:/, "live offboarding data must expose explicit handover items");
expect(dataPath, data, /openKnowledgeTransfers/, "live offboarding data must expose open handover count");
expect(dataPath, data, /controlsClear[\s\S]*openKnowledgeTransfers\s*===\s*0/, "workspace close readiness must include handover state");

const consolePath = "components/offboarding-clearance-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/api\/offboarding\/processes\/\$\{encodeURIComponent\(process\.id\)\}\/assets/, "clearance UI must call governed asset endpoints");
expect(consolePath, consoleSource, /\/assets\/\$\{encodeURIComponent\(assetId\)\}\/status/, "clearance UI must call governed asset transition endpoints");
expect(consolePath, consoleSource, /\/api\/offboarding\/processes\/\$\{encodeURIComponent\(process\.id\)\}\/access/, "clearance UI must call governed access endpoints");
expect(consolePath, consoleSource, /\/access\/\$\{encodeURIComponent\(accessId\)\}\/status/, "clearance UI must call governed access transition endpoints");
expect(consolePath, consoleSource, /WRITTEN_OFF/, "clearance UI must expose explicit asset write-off flow");
expect(consolePath, consoleSource, /EXCEPTION/, "clearance UI must expose explicit access exception flow");
expect(consolePath, consoleSource, /datetime-local/, "clearance UI must capture scheduled revocation time");

const handoverPath = "components/offboarding-knowledge-transfer-console.tsx";
const handover = await source(handoverPath);
expect(handoverPath, handover, /\/knowledge-transfers`/, "handover UI must create governed transfer items");
expect(handoverPath, handover, /\/knowledge-transfers\/\$\{encodeURIComponent\(transferId\)\}\/status/, "handover UI must call governed lifecycle endpoint");
expect(handoverPath, handover, /maxLength=\{180\}/, "handover title UI must mirror server bound");
expect(handoverPath, handover, /maxLength=\{2000\}/, "handover evidence UI must mirror server bound");
expect(handoverPath, handover, /max=\{lastWorkingDate\}/, "handover UI must bound due date to last working date");
expect(handoverPath, handover, /offboarding-transfer-\$\{transfer\.id\}/, "handover rows must expose deep-link anchors");

const loaderPath = "components/offboarding-clearance-loader.tsx";
const loader = await source(loaderPath);
expect(loaderPath, loader, /can\(ctx,\s*"offboarding:write"\)/, "clearance mutation console must only load for offboarding writers");
expect(loaderPath, loader, /getOffboardingWorkspaceData\(ctx,\s*true\)/, "handover UI must receive relationship-scoped recipient choices");
expect(loaderPath, loader, /OffboardingKnowledgeTransferConsole[\s\S]*eligibleEmployments/, "clearance loader must mount the handover console with scoped employments");

const pagePath = "app/module/[slug]/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /slug === "offboarding"[\s\S]*OffboardingClearanceLoader/, "offboarding module must mount the governed clearance loader");

const reminderPath = "lib/offboarding-reminders.ts";
const reminder = await source(reminderPath);
expect(reminderPath, reminder, /knowledgeTransfers:\s*\{\s*select:\s*\{\s*status:\s*true/, "exit-risk scan must include handover state");
expect(reminderPath, reminder, /openKnowledgeTransfers/, "exit-risk notification payload must include open handover count");

if (failures.length) {
  console.error("Offboarding clearance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding clearance validation passed.");
