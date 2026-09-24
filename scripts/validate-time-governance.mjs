import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /"time:self-entry"/, "time self-service must have a dedicated capability");
expect(authPath, auth, /"time:approve"/, "time approval must have a dedicated capability");
expect(authPath, auth, /"time:lock"/, "payroll-ready time locking must have a dedicated capability");
expect(authPath, auth, /"time:configure"/, "schedule configuration must have a dedicated capability");
const employeeGrant = auth.match(/EMPLOYEE:\s*\[[\s\S]*?\],\n\s*MANAGER:/)?.[0] ?? "";
expect(authPath, employeeGrant, /"time:read"[\s\S]*"time:self-entry"/, "employees must receive read plus own time entry capability");
expectAbsent(authPath, employeeGrant, /"time:write"|"time:approve"|"time:lock"|"time:configure"/, "employees must not receive administrative time authority");
expect(authPath, auth, /MANAGER:[\s\S]*"time:self-entry"[\s\S]*"time:approve"/, "managers must separate own time entry from approval authority");

const governancePath = "lib/time-governance.ts";
const governance = await source(governancePath);
expect(governancePath, governance, /validateTimeEntryIntegrity/, "time entry integrity must be centralized");
expect(governancePath, governance, /INVALID_OVERTIME/, "overtime must be bounded by worked time");
expect(governancePath, governance, /MINUTES_EXCEED_INTERVAL/, "worked minutes must not exceed the captured interval");
expect(governancePath, governance, /findEffectiveWorkSchedule/, "time transitions must resolve an effective active schedule");

const entryPath = "app/api/time/entries/route.ts";
const entry = await source(entryPath);
expect(entryPath, entry, /can\(ctx,\s*"time:self-entry"\)/, "own time creation must require self-service capability");
expect(entryPath, entry, /can\(ctx,\s*"time:write"\)/, "on-behalf time creation must require operational write capability");
expect(entryPath, entry, /status:\s*TimeEntryStatus\.DRAFT/, "new time entries must always begin as governed drafts");
expectAbsent(entryPath, entry, /body\.status/, "callers must not choose the initial time-entry state");
expect(entryPath, entry, /validateTimeEntryIntegrity/, "time creation must enforce worked/overtime/interval integrity");
expect(entryPath, entry, /OVERLAP/, "time creation must reject overlapping governed entries");
expect(entryPath, entry, /TransactionIsolationLevel\.Serializable/, "time creation and overlap control must be serialized");
expect(entryPath, entry, /time-entry\.self-created|time-entry\.created/, "time creation must emit audit evidence");

const transitionPath = "app/api/time/entries/[id]/transition/route.ts";
const transition = await source(transitionPath);
expect(transitionPath, transition, /time:self-entry/, "submission must recognize self-service capability");
expect(transitionPath, transition, /time:approve/, "approval/rejection must require explicit approval authority");
expect(transitionPath, transition, /time:lock/, "payroll-ready lock must require explicit lock authority");
expect(transitionPath, transition, /canActOnEmployment/, "time transitions must preserve relationship scope");
expect(transitionPath, transition, /findEffectiveWorkSchedule/, "submit, approval and lock must validate an effective schedule");
expect(transitionPath, transition, /validateTimeEntryIntegrity/, "state transitions must revalidate time integrity");
expect(transitionPath, transition, /SAME_ACTOR_LOCK/, "approval and payroll lock must enforce four-eyes separation");
expect(transitionPath, transition, /updateMany/, "time transitions must use state-aware writes");
expect(transitionPath, transition, /STALE_STATE/, "concurrent state changes must be detected");
expect(transitionPath, transition, /enqueueTimeApprovalNotification/, "submission must notify the manager identity");
expect(transitionPath, transition, /enqueueTimeDecisionNotification/, "approval result must notify the employee identity");
expect(transitionPath, transition, /TransactionIsolationLevel\.Serializable/, "time state transitions must be serialized");

const schedulePath = "app/api/time/schedules/route.ts";
const schedule = await source(schedulePath);
expect(schedulePath, schedule, /mutationOriginAllowed/, "schedule mutation must enforce same-origin policy");
expect(schedulePath, schedule, /can\(ctx,\s*"time:configure"\)/, "schedule creation must require configuration capability");
expect(schedulePath, schedule, /10080/, "weekly schedule minutes must be bounded");
expect(schedulePath, schedule, /validTimeZone/, "schedule timezone must be validated");

const assignmentPath = "app/api/time/schedules/assignments/route.ts";
const assignment = await source(assignmentPath);
expect(assignmentPath, assignment, /can\(ctx,\s*"time:configure"\)/, "schedule assignment must require configuration capability");
expect(assignmentPath, assignment, /canActOnEmployment/, "schedule assignment must remain employment-scoped");
expect(assignmentPath, assignment, /SCHEDULE_RANGE/, "assignment must stay inside schedule effective dates");
expect(assignmentPath, assignment, /OVERLAP/, "future schedule overlaps must be rejected");
expect(assignmentPath, assignment, /TransactionIsolationLevel\.Serializable/, "schedule reassignment must be serialized");
expect(assignmentPath, assignment, /appendAudit/, "schedule assignment must emit audit evidence");

const dataPath = "lib/time-participant-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /employmentId\s*=\s*ctx\.employmentId/, "employee time data must bind to signed employment identity");
expect(dataPath, data, /can\(ctx,\s*"time:self-entry"\)/, "employee time data must be capability gated");
expect(dataPath, data, /workScheduleAssignment\.findFirst/, "self-service must surface the effective work schedule");

const consolePath = "components/time-participant-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/api\/time\/entries/, "time self-service must create drafts through the governed API");
expect(consolePath, consoleSource, /status:\s*"SUBMITTED"/, "time self-service must submit drafts through the state machine");
expect(consolePath, consoleSource, /overlap and overtime integrity are enforced server-side/i, "time UI must disclose server-side integrity controls");

const livePath = "components/work-pay-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /can\(ctx,\s*"time:self-entry"\)/, "time live controls must recognize self-service separately");
expect(livePath, live, /can\(ctx,\s*"time:approve"\)/, "time approval controls must be capability gated");
expect(livePath, live, /can\(ctx,\s*"time:lock"\)/, "time lock controls must be capability gated");

const modulePath = "components/work-pay-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /TimeParticipantConsole/, "authenticated time module must expose employee self-service");
expect(modulePath, modulePage, /getTimeParticipantData\(ctx\)/, "time self-service must load from signed request context");

const notificationPath = "lib/time-notifications.ts";
const notifications = await source(notificationPath);
expect(notificationPath, notifications, /TIME_ENTRY_APPROVAL_REQUIRED/, "submitted time must use a dedicated manager notification");
expect(notificationPath, notifications, /TIME_ENTRY_APPROVED[\s\S]*TIME_ENTRY_REJECTED/, "time decisions must have dedicated employee notifications");
expect(notificationPath, notifications, /workEmail:\s*true/, "time notifications must resolve user identity from employment work email");
expect(notificationPath, notifications, /enqueueNotificationOutbox/, "time notifications must use the durable outbox");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /TIME_ENTRY_APPROVAL_REQUIRED/, "notification center must present manager time approvals");
expect(presentationPath, presentation, /TIME_ENTRY_APPROVED/, "notification center must present approved time");
expect(presentationPath, presentation, /resourceType\s*===\s*"TimeEntry"/, "time notifications must deep-link to Time & Attendance");

if (failures.length) {
  console.error("Time governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated time governance contract: identity-bound self-service, schedule/integrity validation, approval separation, four-eyes payroll locking, notifications and audit evidence are enforced.");
