import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const processPath = "app/api/offboarding/processes/route.ts";
const processSource = await source(processPath);
expect(processPath, processSource, /readJsonObject\(request\)/, "separation creation must use the bounded JSON-object parser");
expect(processPath, processSource, /asEnumValue\(body\.type,\s*Object\.values\(SeparationType\)\)/, "separation type must be server-validated");
expect(processPath, processSource, /asOptionalText\(body\.reasonCode,\s*120\)/, "reason code must be bounded");
expect(processPath, processSource, /asOptionalText\(body\.employeeReason,\s*2000\)/, "employee-provided separation reason must be bounded");
expect(processPath, processSource, /managerEmploymentId\s*===\s*employment\.id/, "an employment must not be assigned as its own separation manager");
expect(processPath, processSource, /separationProcess\.findFirst\([\s\S]*status:\s*\{\s*notIn:\s*\[SeparationStatus\.CLOSED,\s*SeparationStatus\.CANCELLED\]\s*\}/, "creation must reject a second open separation for the same employment");
expect(processPath, processSource, /TransactionIsolationLevel\.Serializable/, "separation creation must use serializable isolation");
expect(processPath, processSource, /P2034/, "concurrent separation creation conflicts must be controlled");
expect(processPath, processSource, /Governed separation initiation with cross-functional clearance controls/, "creation audit must record the governed clearance purpose");

const taskPath = "app/api/offboarding/processes/[id]/tasks/[taskId]/complete/route.ts";
const task = await source(taskPath);
expect(taskPath, task, /const transitions:[\s\S]*Record<ExitTaskStatus/, "exit tasks must use an explicit lifecycle transition map");
expect(taskPath, task, /transitionRequiresReason[\s\S]*ExitTaskStatus\.BLOCKED[\s\S]*ExitTaskStatus\.WAIVED/, "blocked and waived exit controls must require reasons");
expect(taskPath, task, /asOptionalText\(body\.note,\s*500\)/, "exit control reasons must be bounded");
expect(taskPath, task, /separationTask\.updateMany\([\s\S]*status:\s*task\.status/, "exit task mutations must be state-aware");
expect(taskPath, task, /AssetReturnStatus\.RETURNED[\s\S]*AssetReturnStatus\.WRITTEN_OFF/, "exit readiness must include asset return state");
expect(taskPath, task, /AccessRevocationStatus\.REVOKED[\s\S]*AccessRevocationStatus\.EXCEPTION/, "exit readiness must include access revocation state");
expect(taskPath, task, /SeparationStatus\.READY_TO_CLOSE/, "exit control transitions must derive ready-to-close state");
expect(taskPath, task, /SeparationStatus\.FINAL_PAY_REVIEW/, "payroll-only blockers must surface final-pay review state");
expect(taskPath, task, /offboarding\.process-\$\{process\.status\.toLowerCase\(\)\}-to-\$\{nextProcessStatus\.toLowerCase\(\)\}/, "derived process state changes must be auditable");
expect(taskPath, task, /TransactionIsolationLevel\.Serializable/, "exit task lifecycle must use serializable isolation");
expect(taskPath, task, /P2034/, "exit task serialization conflicts must be controlled");
expectAbsent(taskPath, task, /separationTask\.update\(\{/, "exit task lifecycle must not use blind single-row updates");

const closePath = "app/api/offboarding/processes/[id]/close/route.ts";
const close = await source(closePath);
expect(closePath, close, /process\.status\s*!==\s*SeparationStatus\.READY_TO_CLOSE/, "final termination must require ready-to-close state");
expect(closePath, close, /process\.initiatedById\s*===\s*ctx\.actorId/, "separation initiator must not perform final termination");
expect(closePath, close, /process\.lastWorkingDate\s*>\s*now/, "employment must not terminate before the governed last working date");
expect(closePath, close, /separationTask\.count\([\s\S]*blocking:\s*true[\s\S]*COMPLETED[\s\S]*WAIVED/, "termination must recheck blocking task readiness");
expect(closePath, close, /assetReturn\.count[\s\S]*accessRevocation\.count/, "termination must recheck asset and access readiness");
expect(closePath, close, /employment\.updateMany\([\s\S]*status:\s*employment\.status[\s\S]*TERMINATED/, "employment termination must be state-aware");
expect(closePath, close, /separationProcess\.updateMany\([\s\S]*READY_TO_CLOSE[\s\S]*CLOSED/, "separation close must be state-aware");
expect(closePath, close, /remainingIncumbents[\s\S]*PositionStatus\.FILLED[\s\S]*PositionStatus\.OPEN/, "position reopening must preserve positions with another incumbent and frozen states");
expect(closePath, close, /employment\.exit-terminated/, "employment termination must produce audit evidence");
expect(closePath, close, /offboarding\.process-closed/, "separation closure must produce audit evidence");
expect(closePath, close, /TransactionIsolationLevel\.Serializable/, "final termination must use serializable isolation");
expect(closePath, close, /P2034/, "termination serialization conflicts must be controlled");
expectAbsent(closePath, close, /employment\.update\(\{/, "final employment transition must not be a blind update");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /initiatedById:\s*true/, "offboarding data must expose initiator identity for four-eyes UI context");
expect(dataPath, data, /lastWorkingDateIso:\s*process\.lastWorkingDate\.toISOString\(\)/, "offboarding data must expose machine-readable last working date");
expect(dataPath, data, /dueAtIso:\s*task\.dueAt\?\.toISOString\(\)/, "exit tasks must expose machine-readable due dates");
expect(dataPath, data, /overdueTasks/, "offboarding workspace must surface overdue task risk");
expect(dataPath, data, /exitRiskProcesses/, "offboarding workspace must surface exit-date readiness risk");
expect(dataPath, data, /process\.status\s*===\s*SeparationStatus\.READY_TO_CLOSE/, "ready-to-close metric must require governed process state");

const consolePath = "components/offboarding-operations-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /status===\"BLOCKED\"\|\|status===\"WAIVED\"/, "UI must capture a reason for blockers and waivers");
expect(consolePath, consoleSource, /maxLength=\{500\}/, "UI reason input must mirror server bounds");
expect(consolePath, consoleSource, /lastWorkingDateIso/, "UI must enforce last-working-date closure timing");
expect(consolePath, consoleSource, /initiatedById!==actorId/, "UI must surface four-eyes separation closure when actor identity is provided");
expect(consolePath, consoleSource, /offboarding-process-\$\{process\.id\}/, "process records must expose stable deep-link anchors");
expect(consolePath, consoleSource, /offboarding-task-\$\{task\.id\}/, "task records must expose stable deep-link anchors");
expect(consolePath, consoleSource, /scrollIntoView\(\{behavior:\"smooth\",block:\"center\"\}\)/, "notification context must scroll the target into view");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /actorId=\{ctx\.actorId\}/, "offboarding workspace must pass actor identity into the four-eyes console");
expect(workspacePath, workspace, /data\.overdueTasks/, "workspace metrics must surface overdue exit controls");
expect(workspacePath, workspace, /data\.exitRiskProcesses/, "workspace metrics must surface exit-date risk");

const reminderPath = "lib/offboarding-reminders.ts";
const reminder = await source(reminderPath);
expect(reminderPath, reminder, /OPEN_TASK_STATUSES[\s\S]*NOT_STARTED[\s\S]*IN_PROGRESS[\s\S]*BLOCKED/, "readiness monitoring must scan all open exit task states");
expect(reminderPath, reminder, /HRBP_OFFBOARDING_DUE_SOON_HOURS/, "exit task due-soon window must be runtime configurable");
expect(reminderPath, reminder, /HRBP_OFFBOARDING_EXIT_RISK_HOURS/, "exit-date risk window must be runtime configurable");
expect(reminderPath, reminder, /OFFBOARDING_TASK_BLOCKED[\s\S]*OFFBOARDING_TASK_OVERDUE[\s\S]*OFFBOARDING_TASK_DUE_SOON/, "maintenance must distinguish blocked, overdue and due-soon exit task events");
expect(reminderPath, reminder, /OFFBOARDING_EXIT_READINESS_RISK/, "maintenance must raise a process-level exit-readiness event");
expect(reminderPath, reminder, /tenantId_dedupeKey/, "exit reminders must be idempotent");
expect(reminderPath, reminder, /recipientRoleForDomain/, "unowned exit tasks must route to a governed operational role");
expect(reminderPath, reminder, /appendAudit[\s\S]*offboarding-task\.\$\{reminderState\}/, "task readiness escalations must be auditable");
expect(reminderPath, reminder, /offboarding-process\.exit-readiness-risk/, "process readiness escalation must be auditable");
expectAbsent(reminderPath, reminder, /data:\s*\{\s*status:\s*ExitTaskStatus\./, "maintenance must not silently mutate human-owned exit task states");

const maintenancePath = "app/api/internal/maintenance/route.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /queueOffboardingReadinessReminders/, "scheduled maintenance must include offboarding readiness monitoring");
expect(maintenancePath, maintenance, /const onboardingReadiness = await queueOnboardingReadinessReminders\(\);[\s\S]*const offboardingReadiness = await queueOffboardingReadinessReminders\(\);[\s\S]*Promise\.all/, "audited onboarding and offboarding readiness work must stay serialized before parallel reminders");

const displayPath = "lib/notification-display.ts";
const display = await source(displayPath);
expect(displayPath, display, /OFFBOARDING_TASK_BLOCKED/, "notification UI must localize blocked exit alerts");
expect(displayPath, display, /OFFBOARDING_EXIT_READINESS_RISK/, "notification UI must localize exit-readiness risk");
expect(displayPath, display, /resourceType === \"SeparationTask\"[\s\S]*\/module\/offboarding\?task=/, "task notifications must deep-link to the exit task");
expect(displayPath, display, /resourceType === \"SeparationProcess\"[\s\S]*\/module\/offboarding\?process=/, "process notifications must deep-link to the separation process");

const envPath = ".env.example";
const env = await source(envPath);
expect(envPath, env, /HRBP_OFFBOARDING_DUE_SOON_HOURS=48/, "offboarding due-soon window must be documented");
expect(envPath, env, /HRBP_OFFBOARDING_EXIT_RISK_HOURS=72/, "offboarding exit-risk window must be documented");
expect(envPath, env, /HRBP_OFFBOARDING_REMINDER_BATCH_SIZE=250/, "offboarding reminder batch size must be documented");

if (failures.length) {
  console.error("Offboarding governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding governance validation passed.");
