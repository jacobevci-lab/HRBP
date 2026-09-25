import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /model SeparationManagerReassignment/, "manager handovers must have first-class evidence records");
expect(schemaPath, schema, /reportEmploymentId\s+String[\s\S]*previousManagerEmploymentId\s+String[\s\S]*newManagerEmploymentId\s+String/, "handover evidence must retain report and before/after manager employment ids");
expect(schemaPath, schema, /reason\s+String[\s\S]*changedById\s+String[\s\S]*changedAt\s+DateTime/, "handover evidence must retain reason, actor and timestamp");
expect(schemaPath, schema, /managerReassignments\s+SeparationManagerReassignment\[\]/, "separation process must own manager-handover history");

const routePath = "app/api/offboarding/processes/[id]/manager-handover/route.ts";
const route = await source(routePath);
expect(routePath, route, /mutationOriginAllowed/, "manager handover must enforce same-origin mutation protection");
expect(routePath, route, /can\(ctx,\s*"offboarding:write"\)/, "manager handover must require offboarding write authority");
expect(routePath, route, /canActOnEmployment/, "manager handover must respect employment relationship scope");
expect(routePath, route, /reason\.length\s*<\s*10/, "manager handover must require a meaningful human reason");
expect(routePath, route, /EmploymentStatus\.ACTIVE[\s\S]*EmploymentStatus\.LEAVE/, "new manager must have a live employment state");
expect(routePath, route, /DESCENDANT_MANAGER/, "manager handover must reject reporting-subtree cycle creation");
expect(routePath, route, /managerEmploymentId:\s*process\.employmentId[\s\S]*managerEmploymentId:\s*newManager\.id/, "direct reports must be state-aware reassigned from departing to selected manager");
expect(routePath, route, /separationManagerReassignment\.createMany/, "manager handover evidence must persist transactionally");
expect(routePath, route, /LifecycleEventType\.MANAGER_CHANGED/, "each moved employment must receive a manager-changed lifecycle event");
expect(routePath, route, /offboarding\.manager-handover-completed/, "manager handover must append restricted audit evidence");
expect(routePath, route, /recalculateSeparationReadiness/, "manager handover must immediately recalculate exit readiness");
expect(routePath, route, /TransactionIsolationLevel\.Serializable/, "manager handover must use serializable isolation");
expect(routePath, route, /P2034/, "manager handover must handle serialization conflicts");

const readinessPath = "lib/offboarding-readiness.ts";
const readiness = await source(readinessPath);
expect(readinessPath, readiness, /managerEmploymentId:\s*process\.employmentId/, "readiness must count active direct reports on the departing manager");
expect(readinessPath, readiness, /directReportsOpen\s*===\s*0/, "active direct reports must block operational clearance");
expect(readinessPath, readiness, /openDirectReports:\s*directReportsOpen/, "readiness result must expose manager-continuity debt");

const closePath = "app/api/offboarding/processes/[id]/close/route.ts";
const close = await source(closePath);
expect(closePath, close, /managerEmploymentId:\s*process\.employmentId/, "final closure must independently recheck active direct reports");
expect(closePath, close, /directReports/, "final closure blocker response must surface direct-report debt");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /directReportsOpen:\s*number/, "live offboarding rows must expose direct-report blockers");
expect(dataPath, data, /directReports:\s*OffboardingDirectReportRow\[\]/, "live offboarding rows must expose affected direct reports");
expect(dataPath, data, /managerCandidates:\s*OffboardingManagerCandidate\[\]/, "workspace data must provide scoped manager candidates");
expect(dataPath, data, /directReportsOpen\s*===\s*0/, "live ready-to-close calculation must include manager continuity");

const consolePath = "components/offboarding-manager-handover-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/manager-handover`/, "manager continuity UI must call the governed endpoint");
expect(consolePath, consoleSource, /Reassign reports|Bağlı çalışanları devret/, "manager continuity UI must expose an explicit human handover action");
expect(consolePath, consoleSource, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "manager handover UI must mirror reason bounds");
expect(consolePath, consoleSource, /reporting subtree|alt raporlama ağındaki/, "manager handover UI must explain cycle protection");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /OffboardingManagerHandoverConsole/, "authorized HR users must receive the manager-handover console");
expect(workspacePath, workspace, /Manager continuity|Yönetici sürekliliği/, "closure gate must surface manager continuity as a first-class control");

const historyPath = "lib/offboarding-history-data.ts";
const history = await source(historyPath);
expect(historyPath, history, /managerReassignments[\s\S]*Direct report reassigned for manager continuity/, "terminal history must reconstruct manager reassignment evidence");
expect(historyPath, history, /kind:\s*"MANAGER"/, "manager handovers must be distinct terminal-history events");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /"offboarding-manager-handover:validate":\s*"node scripts\/validate-offboarding-manager-handover\.mjs"/, "package scripts must expose manager-handover validation");
expect(packagePath, pkg, /offboarding-backfill:validate[\s\S]*offboarding-manager-handover:validate[\s\S]*maintenance:validate/, "prebuild must run manager-handover validation");

if (failures.length) {
  console.error("Offboarding manager-handover validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding manager-handover validation passed.");
