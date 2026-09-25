import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const i18nPath = "lib/i18n.ts";
const i18n = await source(i18nPath);
expect(i18nPath, i18n, /"nav\.commandCenter":\s*"Dashboard"/g, "dashboard navigation must use the Dashboard label in both locales");
expectAbsent(i18nPath, i18n, /Command Center|Komuta Merkezi/, "legacy Command Center naming must be removed from UI translations");

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /model SeparationScheduleAmendment/, "schedule amendments must have first-class evidence records");
expect(schemaPath, schema, /previousNoticeDate[\s\S]*newNoticeDate[\s\S]*previousLastWorkingDate[\s\S]*newLastWorkingDate/, "amendment evidence must retain before/after dates");
expect(schemaPath, schema, /reason\s+String[\s\S]*changedById\s+String[\s\S]*changedAt\s+DateTime/, "amendment evidence must retain reason, actor and timestamp");
expect(schemaPath, schema, /scheduleAmendments\s+SeparationScheduleAmendment\[\]/, "separation process must own amendment history");

const routePath = "app/api/offboarding/processes/[id]/schedule/route.ts";
const route = await source(routePath);
expect(routePath, route, /mutationOriginAllowed/, "schedule changes must enforce same-origin mutation protection");
expect(routePath, route, /can\(ctx,\s*"offboarding:write"\)/, "schedule changes must require offboarding write authority");
expect(routePath, route, /canActOnEmployment/, "schedule changes must respect employment relationship scope");
expect(routePath, route, /reason\.length\s*<\s*10/, "schedule changes must require a meaningful human reason");
expect(routePath, route, /finalSettlementStatus\s*===\s*"SETTLED"[\s\S]*SETTLEMENT_SETTLED/, "settled final payment must block date amendments until reversal");
expect(routePath, route, /AccessRevocationStatus\.SCHEDULED[\s\S]*shiftedAt/, "scheduled access revocations must move with amended exit dates");
expect(routePath, route, /dueAt:\s*process\.lastWorkingDate[\s\S]*dueAt:\s*lastWorkingDate/, "aligned open task deadlines must synchronize to the amended last day");
expect(routePath, route, /knowledgeTransfer[\s\S]*dueAt:\s*process\.lastWorkingDate[\s\S]*dueAt:\s*lastWorkingDate/, "aligned knowledge-transfer deadlines must synchronize to the amended last day");
expect(routePath, route, /separationScheduleAmendment\.create/, "schedule amendment evidence must be persisted transactionally");
expect(routePath, route, /OFFBOARDING_EXIT_READINESS_RISK[\s\S]*OFFBOARDING_READY_TO_CLOSE/, "stale process readiness notifications must be retired");
expect(routePath, route, /OFFBOARDING_TASK_BLOCKED[\s\S]*OFFBOARDING_TASK_DUE_SOON[\s\S]*OFFBOARDING_TASK_OVERDUE/, "stale task reminder payloads must be retired when due dates shift");
expect(routePath, route, /offboarding\.schedule-amended/, "schedule changes must append restricted audit evidence");
expect(routePath, route, /recalculateSeparationReadiness/, "schedule changes must recalculate exit readiness");
expect(routePath, route, /updatedAt:\s*process\.updatedAt/, "schedule changes must use optimistic state protection");
expect(routePath, route, /TransactionIsolationLevel\.Serializable/, "schedule changes must use serializable isolation");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /noticeDate:\s*string[\s\S]*noticeDateIso:\s*string\s*\|\s*null/, "live offboarding data must expose notice date for amendments");
expect(dataPath, data, /noticeDate:\s*true[\s\S]*lastWorkingDate:\s*true/, "workspace query must select both schedule dates");

const consolePath = "components/offboarding-schedule-amendment-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/schedule`/, "amendment UI must call the governed schedule endpoint");
expect(consolePath, consoleSource, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "amendment UI must mirror reason bounds");
expect(consolePath, consoleSource, /finalSettlementClear/, "amendment UI must surface the settled-payment guard");
expect(consolePath, consoleSource, /noticeDate[\s\S]*lastWorkingDate/, "amendment UI must edit notice and last-working dates together");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /OffboardingScheduleAmendmentConsole/, "authorized HR operations users must receive the schedule amendment console");

const historyPath = "lib/offboarding-history-data.ts";
const history = await source(historyPath);
expect(historyPath, history, /scheduleAmendments[\s\S]*Exit schedule amended/, "terminal history must reconstruct schedule amendments");
expect(historyPath, history, /kind:\s*"SCHEDULE"/, "schedule amendments must be distinct history events");

if (failures.length) {
  console.error("Dashboard/offboarding schedule-amendment validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Dashboard/offboarding schedule-amendment validation passed.");
