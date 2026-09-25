import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const transitionPath = "app/api/onboarding/tasks/[id]/status/route.ts";
const transition = await source(transitionPath);
expect(transitionPath, transition, /transitionRequiresReason[\s\S]*BLOCKED[\s\S]*WAIVED/, "blocked and waived transitions must require an explicit reason");
expect(transitionPath, transition, /asOptionalText\(body\.note,\s*500\)/, "transition reason must be bounded before audit persistence");
expect(transitionPath, transition, /onboardingTask\.updateMany\([\s\S]*status:\s*task\.status/, "task state change must use a state-aware concurrent update");
expect(transitionPath, transition, /onboardingPlan\.updateMany\([\s\S]*status:\s*task\.plan\.status/, "derived plan state must use a state-aware concurrent update");
expect(transitionPath, transition, /every\(\(status\)\s*=>\s*status\s*===\s*OnboardingTaskStatus\.COMPLETED\s*\|\|\s*status\s*===\s*OnboardingTaskStatus\.WAIVED\)/, "plan completion must require every task to be completed or explicitly waived");
expect(transitionPath, transition, /ONBOARDING_PLAN_\$\{task\.plan\.status\}_TO_\$\{planStatus\}/, "plan lifecycle changes must have a dedicated audit event");
expect(transitionPath, transition, /Day-one readiness gate cleared/, "plan completion audit must record readiness-gate clearance");
expect(transitionPath, transition, /terminal\(next\)[\s\S]*notificationOutbox\.updateMany\([\s\S]*resourceType:\s*"OnboardingTask"/, "terminal task transitions must close resolved task reminders");
expect(transitionPath, transition, /ONBOARDING_READY_FOR_ACTIVATION/, "readiness completion must notify the onboarding owner that activation is available");
expect(transitionPath, transition, /recipientRole:\s*task\.plan\.ownerId\s*\?\s*null\s*:\s*PlatformRole\.HR_OPERATIONS/, "readiness completion must fall back to HR operations when the plan has no direct owner");
expect(transitionPath, transition, /dedupeKey:\s*`onboarding-plan:\$\{task\.planId\}:ready-for-activation`/, "readiness notification must be idempotent");
expect(transitionPath, transition, /reminderState:\s*"activation-ready"/, "readiness notification payload must identify the activation-ready state");
expect(transitionPath, transition, /TransactionIsolationLevel\.Serializable/, "task and plan transitions must use serializable isolation");
expect(transitionPath, transition, /P2034/, "serialization conflicts must return a controlled conflict response");
expectAbsent(transitionPath, transition, /data:\s*\{\s*status:\s*OnboardingStatus\.COMPLETED\s*\}/, "plan completion must never be written unconditionally");

const activationPath = "app/api/onboarding/plans/[id]/activate/route.ts";
const activation = await source(activationPath);
expect(activationPath, activation, /can\(ctx,\s*"onboarding:write"\)[\s\S]*can\(ctx,\s*"people:write"\)/, "employment activation must require onboarding and people write authority");
expect(activationPath, activation, /canAccessOnboardingPlan\(population,\s*plan\)/, "activation must enforce the governed onboarding population scope");
expect(activationPath, activation, /plan\.status\s*!==\s*OnboardingStatus\.COMPLETED/, "activation must require a completed onboarding plan");
expect(activationPath, activation, /employment\.status\s*!==\s*EmploymentStatus\.PREBOARDING/, "activation must only transition a preboarding employment");
expect(activationPath, activation, /targetStartDate\s*>\s*now[\s\S]*employment\.startDate\s*>\s*now/, "activation must reject handoff before the governed start date");
expect(activationPath, activation, /onboardingTask\.count\([\s\S]*notIn:\s*\[OnboardingTaskStatus\.COMPLETED,\s*OnboardingTaskStatus\.WAIVED\]/, "activation must recheck task readiness instead of trusting plan status alone");
expect(activationPath, activation, /employment\.updateMany\([\s\S]*status:\s*EmploymentStatus\.PREBOARDING[\s\S]*data:\s*\{\s*status:\s*EmploymentStatus\.ACTIVE\s*\}/, "employment activation must be a state-aware PREBOARDING to ACTIVE mutation");
expect(activationPath, activation, /EMPLOYMENT_PREBOARDING_TO_ACTIVE/, "employment activation must write immutable audit evidence");
expect(activationPath, activation, /ONBOARDING_HANDOFF_TO_ACTIVE_EMPLOYMENT/, "onboarding handoff must be separately auditable");
expect(activationPath, activation, /notificationOutbox\.updateMany\([\s\S]*resourceType:\s*"OnboardingPlan"[\s\S]*readAt:\s*null[\s\S]*data:\s*\{\s*readAt:\s*now\s*\}/, "activation must close plan notifications that no longer require action");
expect(activationPath, activation, /TransactionIsolationLevel\.Serializable/, "employment activation must use serializable isolation");
expect(activationPath, activation, /P2034/, "activation serialization conflicts must return a controlled conflict response");

const reminderPath = "lib/onboarding-reminders.ts";
const reminder = await source(reminderPath);
expect(reminderPath, reminder, /OPEN_TASK_STATUSES[\s\S]*NOT_STARTED[\s\S]*IN_PROGRESS[\s\S]*BLOCKED/, "readiness monitoring must scan all non-terminal onboarding task states");
expect(reminderPath, reminder, /HRBP_ONBOARDING_DUE_SOON_HOURS/, "task due-soon window must be runtime configurable");
expect(reminderPath, reminder, /HRBP_ONBOARDING_START_RISK_HOURS/, "day-one readiness window must be runtime configurable");
expect(reminderPath, reminder, /ONBOARDING_TASK_BLOCKED[\s\S]*ONBOARDING_TASK_OVERDUE[\s\S]*ONBOARDING_TASK_DUE_SOON/, "maintenance must distinguish blocked, overdue and due-soon task events");
expect(reminderPath, reminder, /ONBOARDING_START_READINESS_RISK/, "maintenance must raise a plan-level start-readiness event");
expect(reminderPath, reminder, /tenantId_dedupeKey/, "readiness notifications must be idempotent across repeated maintenance runs");
expect(reminderPath, reminder, /recipientRole:\s*recipientUserId\s*\?\s*null\s*:\s*PlatformRole\.HR_OPERATIONS/, "unowned task reminders must fall back to governed HR operations recipients");
expect(reminderPath, reminder, /ownerType\.trim\(\)\.toUpperCase\(\)\s*===\s*"MANAGER"[\s\S]*managerRecipientUserId/, "manager-owned tasks should resolve the governed manager identity when available");
expect(reminderPath, reminder, /appendAudit[\s\S]*onboarding-task\.\$\{reminderState\}/, "task readiness escalations must be auditable");
expect(reminderPath, reminder, /appendAudit[\s\S]*onboarding-plan\.start-readiness-risk/, "plan start-risk escalation must be auditable");
expectAbsent(reminderPath, reminder, /data:\s*\{\s*status:\s*OnboardingTaskStatus\./, "maintenance must not silently mutate human-owned onboarding task states");

const maintenancePath = "app/api/internal/maintenance/route.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /queueOnboardingReadinessReminders/, "operational maintenance must include onboarding readiness monitoring");
expect(maintenancePath, maintenance, /const onboardingReadiness = await queueOnboardingReadinessReminders\(\);[\s\S]*Promise\.all/, "audited onboarding readiness work must run serially before parallel non-state reminder work");

const displayPath = "lib/notification-display.ts";
const display = await source(displayPath);
expect(displayPath, display, /ONBOARDING_TASK_BLOCKED/, "notification UI must localize blocked onboarding alerts");
expect(displayPath, display, /ONBOARDING_START_READINESS_RISK/, "notification UI must localize day-one readiness alerts");
expect(displayPath, display, /ONBOARDING_READY_FOR_ACTIVATION/, "notification UI must localize activation-ready onboarding alerts");
expect(displayPath, display, /reminderState === "activation-ready"/, "notification summary must explain activation-ready onboarding state");
expect(displayPath, display, /resourceType === "OnboardingTask"[\s\S]*\/module\/onboarding\?task=/, "task notifications must deep-link to the onboarding task");
expect(displayPath, display, /resourceType === "OnboardingPlan"[\s\S]*\/module\/onboarding\?plan=/, "plan notifications must deep-link to the onboarding plan");

for (const componentPath of ["components/notification-center.tsx", "components/notifications-module-page.tsx"]) {
  const component = await source(componentPath);
  expect(componentPath, component, /notificationDisplayResourceHref/, "notification surfaces must use onboarding-aware deep links");
  expect(componentPath, component, /notificationDisplayTitle/, "notification surfaces must use onboarding-aware localized titles");
  expect(componentPath, component, /notificationDisplaySummary/, "notification surfaces must use onboarding-aware summaries");
}

const dataPath = "lib/onboarding-operations-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /targetStartDate:\s*true/, "operations data must expose the target start date for readiness context");
expect(dataPath, data, /targetStartDate:\s*plan\.targetStartDate\.toISOString\(\)/, "target start date must be serialized for the client console");
expect(dataPath, data, /EmploymentStatus\.PREBOARDING/, "completed onboarding must remain in the operations queue while employment is still preboarding");
expect(dataPath, data, /employmentStatus:\s*plan\.employment\?\.status\s*\?\?\s*null/, "operations data must expose governed employment state for handoff controls");

const consolePath = "components/onboarding-operations-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /targetStartDate:\s*string/, "console contract must include target start date");
expect(consolePath, consoleSource, /employmentStatus:\s*string\s*\|\s*null/, "console contract must include employment state");
expect(consolePath, consoleSource, /status === "BLOCKED" \|\| status === "WAIVED"/, "block and waive actions must open the reason capture flow");
expect(consolePath, consoleSource, /JSON\.stringify\(\{ status, \.\.\.\(note \? \{ note \} : \{\}\) \}\)/, "captured transition reason must be sent to the API");
expect(consolePath, consoleSource, /fetch\(`\/api\/onboarding\/plans\/\$\{planId\}\/activate`/, "completed onboarding must expose the governed activation endpoint");
expect(consolePath, consoleSource, /readyForActivation\s*=\s*planStatus\s*===\s*"COMPLETED"\s*&&\s*employmentStatus\s*===\s*"PREBOARDING"/, "activation UI must only appear for a completed preboarding handoff");
expect(consolePath, consoleSource, /disabled=\{pending !== null \|\| !startDateReached\}/, "activation control must stay disabled before the governed start date");
expect(consolePath, consoleSource, /new URLSearchParams\(window\.location\.search\)/, "onboarding console must consume notification deep-link query context");
expect(consolePath, consoleSource, /onboarding-task-\$\{task\.id\}/, "onboarding tasks must expose stable deep-link anchors");
expect(consolePath, consoleSource, /onboarding-plan-\$\{planId\}/, "onboarding plans must expose stable deep-link anchors");
expect(consolePath, consoleSource, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/, "notification targets must scroll into view");
expect(consolePath, consoleSource, /reasonEditor\.text\.trim\(\)/, "reason confirmation must reject empty blocker or waiver explanations");

if (failures.length) {
  console.error("Onboarding readiness validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Onboarding readiness validation passed.");
