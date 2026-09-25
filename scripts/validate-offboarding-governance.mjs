import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const processPath = "app/api/offboarding/processes/route.ts";
const processSource = await source(processPath);
expect(processPath, processSource, /readJsonObject\(request\)/, "separation creation must use bounded JSON parsing");
expect(processPath, processSource, /asEnumValue\(body\.type,\s*Object\.values\(SeparationType\)\)/, "separation type must be server-validated");
expect(processPath, processSource, /asOptionalText\(body\.reasonCode,\s*120\)/, "reason code must be bounded");
expect(processPath, processSource, /asOptionalText\(body\.employeeReason,\s*2000\)/, "employee reason must be bounded");
expect(processPath, processSource, /managerEmploymentId\s*===\s*employment\.id/, "employment cannot be its own separation manager");
expect(processPath, processSource, /status:\s*\{\s*notIn:\s*\[SeparationStatus\.CLOSED,\s*SeparationStatus\.CANCELLED\]/, "creation must reject another open separation");
expect(processPath, processSource, /TransactionIsolationLevel\.Serializable/, "creation must use serializable isolation");
expect(processPath, processSource, /P2034/, "concurrent creation conflicts must be controlled");

const readinessPath = "lib/offboarding-readiness.ts";
const readiness = await source(readinessPath);
expect(readinessPath, readiness, /terminalExitTaskStatuses[\s\S]*COMPLETED[\s\S]*WAIVED/, "task terminal states must be centralized");
expect(readinessPath, readiness, /terminalAssetReturnStatuses[\s\S]*RETURNED[\s\S]*WRITTEN_OFF/, "asset terminal states must be centralized");
expect(readinessPath, readiness, /terminalAccessRevocationStatuses[\s\S]*REVOKED[\s\S]*EXCEPTION/, "access terminal states must be centralized");
expect(readinessPath, readiness, /FINAL_PAY_REVIEW[\s\S]*READY_TO_CLOSE|READY_TO_CLOSE[\s\S]*FINAL_PAY_REVIEW/, "readiness must derive final-pay and close-ready states");
expect(readinessPath, readiness, /separationProcess\.updateMany\([\s\S]*status:\s*process\.status/, "derived process transitions must be state-aware");
expect(readinessPath, readiness, /appendAudit/, "derived readiness changes must be auditable");

const taskPath = "app/api/offboarding/processes/[id]/tasks/[taskId]/complete/route.ts";
const task = await source(taskPath);
expect(taskPath, task, /const transitions:[\s\S]*Record<ExitTaskStatus/, "exit tasks must use an explicit lifecycle map");
expect(taskPath, task, /transitionRequiresReason[\s\S]*BLOCKED[\s\S]*WAIVED/, "blocked and waived tasks must require reasons");
expect(taskPath, task, /asOptionalText\(body\.note,\s*500\)/, "task reason must be bounded");
expect(taskPath, task, /separationTask\.updateMany\([\s\S]*status:\s*task\.status/, "task mutation must be state-aware");
expect(taskPath, task, /recalculateSeparationReadiness/, "task changes must use centralized readiness");
expect(taskPath, task, /TransactionIsolationLevel\.Serializable/, "task lifecycle must use serializable isolation");
expect(taskPath, task, /P2034/, "task serialization conflicts must be controlled");
expectAbsent(taskPath, task, /assetReturn\.count/, "task route must not duplicate asset readiness logic");

const closePath = "app/api/offboarding/processes/[id]/close/route.ts";
const close = await source(closePath);
expect(closePath, close, /process\.status\s*!==\s*SeparationStatus\.READY_TO_CLOSE/, "final termination must require ready-to-close");
expect(closePath, close, /process\.initiatedById\s*===\s*ctx\.actorId/, "initiator must not perform final termination");
expect(closePath, close, /process\.lastWorkingDate\s*>\s*now/, "termination must wait for last working date");
expect(closePath, close, /separationTask\.count[\s\S]*assetReturn\.count[\s\S]*accessRevocation\.count/, "termination must recheck all clearance domains");
expect(closePath, close, /employment\.updateMany\([\s\S]*TERMINATED/, "employment termination must be state-aware");
expect(closePath, close, /separationProcess\.updateMany\([\s\S]*READY_TO_CLOSE[\s\S]*CLOSED/, "process closure must be state-aware");
expect(closePath, close, /remainingIncumbents[\s\S]*PositionStatus\.OPEN/, "position reopening must respect other incumbents");
expect(closePath, close, /employment\.exit-terminated[\s\S]*offboarding\.process-closed/, "termination and process closure must be audited");
expect(closePath, close, /TransactionIsolationLevel\.Serializable/, "closure must use serializable isolation");
expect(closePath, close, /P2034/, "closure serialization conflicts must be controlled");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /initiatedById:\s*true/, "offboarding data must expose initiator for four-eyes UI");
expect(dataPath, data, /lastWorkingDateIso/, "offboarding data must expose machine-readable last day");
expect(dataPath, data, /overdueTasks[\s\S]*exitRiskProcesses/, "workspace must surface overdue and exit-date risk");
expect(dataPath, data, /assets:[\s\S]*accessControls:/, "workspace data must expose asset and access controls");

const consolePath = "components/offboarding-operations-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /status===\"BLOCKED\"\|\|status===\"WAIVED\"/, "UI must capture blocker/waiver reason");
expect(consolePath, consoleSource, /maxLength=\{500\}/, "UI reason must mirror server bound");
expect(consolePath, consoleSource, /initiatedById!==actorId/, "UI must surface four-eyes closure");
expect(consolePath, consoleSource, /offboarding-process-\$\{process\.id\}[\s\S]*offboarding-task-\$\{task\.id\}/, "UI must expose notification deep-link anchors");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /actorId=\{ctx\.actorId\}/, "workspace must pass actor identity to four-eyes console");
expect(workspacePath, workspace, /data\.overdueTasks[\s\S]*data\.exitRiskProcesses/, "workspace metrics must surface exit risk");

const reminderPath = "lib/offboarding-reminders.ts";
const reminder = await source(reminderPath);
expect(reminderPath, reminder, /OPEN_TASK_STATUSES[\s\S]*NOT_STARTED[\s\S]*IN_PROGRESS[\s\S]*BLOCKED/, "readiness monitor must scan open task states");
expect(reminderPath, reminder, /HRBP_OFFBOARDING_DUE_SOON_HOURS[\s\S]*HRBP_OFFBOARDING_EXIT_RISK_HOURS/, "reminder windows must be runtime configurable");
expect(reminderPath, reminder, /OFFBOARDING_TASK_BLOCKED[\s\S]*OFFBOARDING_TASK_OVERDUE[\s\S]*OFFBOARDING_TASK_DUE_SOON/, "task reminder events must be distinct");
expect(reminderPath, reminder, /OFFBOARDING_EXIT_READINESS_RISK/, "process exit-risk event must exist");
expect(reminderPath, reminder, /tenantId_dedupeKey/, "reminders must be idempotent");
expect(reminderPath, reminder, /appendAudit/, "readiness escalations must be audited");
expectAbsent(reminderPath, reminder, /data:\s*\{\s*status:\s*ExitTaskStatus\./, "maintenance must not mutate human task states");

const maintenancePath = "app/api/internal/maintenance/route.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /queueOnboardingReadinessReminders[\s\S]*queueOffboardingReadinessReminders[\s\S]*Promise\.all/, "audited readiness jobs must remain serialized before parallel reminders");

const displayPath = "lib/notification-display.ts";
const display = await source(displayPath);
expect(displayPath, display, /OFFBOARDING_TASK_BLOCKED[\s\S]*OFFBOARDING_EXIT_READINESS_RISK/, "notification UI must localize offboarding risk");
expect(displayPath, display, /resourceType === \"SeparationTask\"[\s\S]*\/module\/offboarding\?task=/, "task notification must deep-link to offboarding");
expect(displayPath, display, /resourceType === \"SeparationProcess\"[\s\S]*\/module\/offboarding\?process=/, "process notification must deep-link to offboarding");

const envPath = ".env.example";
const env = await source(envPath);
expect(envPath, env, /HRBP_OFFBOARDING_DUE_SOON_HOURS=48[\s\S]*HRBP_OFFBOARDING_EXIT_RISK_HOURS=72[\s\S]*HRBP_OFFBOARDING_REMINDER_BATCH_SIZE=250/, "offboarding runtime defaults must be documented");

if (failures.length) {
  console.error("Offboarding governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding governance validation passed.");
