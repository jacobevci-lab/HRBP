import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/employee-relations-lifecycle.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /model EmployeeCaseStatusTransition/, "case status transitions must have first-class evidence");
expect(schemaPath, schema, /fromStatus\s+CaseStatus[\s\S]*toStatus\s+CaseStatus[\s\S]*actorId\s+String[\s\S]*occurredAt\s+DateTime/, "case transition evidence must retain before/after state, actor and time");
expect(schemaPath, schema, /model CaseActionStatusTransition/, "corrective-action transitions must have first-class evidence");
expect(schemaPath, schema, /classification\s+DataClassification\s+@default\(HIGHLY_RESTRICTED\)/g, "lifecycle evidence must remain highly restricted");

const caseRoutePath = "app/api/employee-relations/cases/[id]/status/route.ts";
const caseRoute = await source(caseRoutePath);
expect(caseRoutePath, caseRoute, /mutationOriginAllowed/, "case transitions must enforce same-origin protection");
expect(caseRoutePath, caseRoute, /can\(ctx,\s*"cases:write"\)/, "case transitions must require case write authority");
expect(caseRoutePath, caseRoute, /getCaseWallCase/, "case transitions must remain behind the case wall");
expect(caseRoutePath, caseRoute, /reason\.length\s*<\s*10/, "material case transitions must require a meaningful reason");
expect(caseRoutePath, caseRoute, /caseAllegation\.count[\s\S]*caseAction\.count[\s\S]*caseAppeal\.count/, "resolution and closure must recheck investigative blockers");
expect(caseRoutePath, caseRoute, /RESOLUTION_BLOCKED/, "resolution must be blocked while allegations or actions remain open");
expect(caseRoutePath, caseRoute, /CLOSURE_BLOCKED/, "closure must be blocked while allegations, actions or appeals remain active");
expect(caseRoutePath, caseRoute, /employeeCaseStatusTransition\.create/, "case state changes must create transition evidence");
expect(caseRoutePath, caseRoute, /DataClassification\.HIGHLY_RESTRICTED/, "case lifecycle audit and notifications must retain classification");
expect(caseRoutePath, caseRoute, /TransactionIsolationLevel\.Serializable/, "case transitions must use serializable isolation");
expect(caseRoutePath, caseRoute, /ER_CASE_STATUS_CHANGED/, "case members must receive minimal status-change notification intent");

const actionStatusPath = "app/api/employee-relations/cases/[id]/actions/[actionId]/status/route.ts";
const actionStatus = await source(actionStatusPath);
expect(actionStatusPath, actionStatus, /getCaseWallCase/, "corrective-action transitions must remain behind the case wall");
expect(actionStatusPath, actionStatus, /CaseActionStatus\.COMPLETED[\s\S]*CaseActionStatus\.CANCELLED/, "corrective actions must have explicit terminal states");
expect(actionStatusPath, actionStatus, /reason\.length\s*<\s*10/, "corrective-action completion and cancellation must require a reason");
expect(actionStatusPath, actionStatus, /caseActionStatusTransition\.create/, "corrective-action transitions must create immutable evidence");
expect(actionStatusPath, actionStatus, /TransactionIsolationLevel\.Serializable/, "corrective-action transitions must use serializable isolation");
expect(actionStatusPath, actionStatus, /ER_CASE_ACTION_STATUS_CHANGED/, "action owners must receive status-change notification intent");

const createCasePath = "app/api/employee-relations/cases/route.ts";
const createCase = await source(createCasePath);
expect(createCasePath, createCase, /readJsonObject/, "case intake must use safe JSON object parsing");
expect(createCasePath, createCase, /asText\(body\.caseType,\s*80\)/, "case type must be bounded");
expect(createCasePath, createCase, /asText\(body\.title,\s*200\)/, "case title must be bounded");

const actionCreatePath = "app/api/employee-relations/cases/[id]/actions/route.ts";
const actionCreate = await source(actionCreatePath);
expect(actionCreatePath, actionCreate, /asText\(body\.actionType,\s*80\)/, "corrective action type must be bounded");
expect(actionCreatePath, actionCreate, /asText\(body\.description,\s*4000\)/, "corrective action description must be bounded");
expect(actionCreatePath, actionCreate, /ER_CASE_ACTION_ASSIGNED/, "new corrective actions must notify a different owner");
expect(actionCreatePath, actionCreate, /take:\s*200/, "case action reads must be bounded");

const wallPath = "lib/case-wall.ts";
const wall = await source(wallPath);
expect(wallPath, wall, /take:\s*200/, "case wall register must remain bounded");
expect(wallPath, wall, /ownerUserId:\s*ctx\.actorId[\s\S]*assignments:/, "case wall must remain ownership/assignment scoped");

const livePath = "lib/employee-relations-lifecycle-live-data.ts";
const live = await source(livePath);
expect(livePath, live, /listCaseWallCases/, "lifecycle workspace must derive its population from the case wall");
expect(livePath, live, /getCaseWallCase\(ctx,\s*focusCaseId/, "deep-link focus must recheck case-wall authorization before loading a case outside the bounded register");
expect(livePath, live, /resolutionStatuses\s*=\s*new Set<CaseStatus>/, "resolution readiness must use a type-safe CaseStatus set");
expect(livePath, live, /employeeCaseStatusTransition\.findMany[\s\S]*take:\s*500/, "transition history query must be bounded");
expect(livePath, live, /readyToResolve[\s\S]*readyToClose/, "workspace must derive resolution and closure readiness from blockers");
expect(livePath, live, /focusKind[\s\S]*action[\s\S]*appeal/, "workspace must preserve exact case/action/appeal focus semantics");
expect(livePath, live, /P2021[\s\S]*P2022/, "new lifecycle evidence must fail soft during schema rollout");

const actionUiPath = "components/employee-relations-case-lifecycle-actions.tsx";
const actionUi = await source(actionUiPath);
expect(actionUiPath, actionUi, /\/api\/employee-relations\/cases\/\$\{encodeURIComponent\(caseId\)\}\/status/, "case UI must call the governed lifecycle endpoint");
expect(actionUiPath, actionUi, /actions\/\$\{encodeURIComponent\(action\.id\)\}\/status/, "corrective-action UI must call the governed action endpoint");
expect(actionUiPath, actionUi, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "lifecycle reason UI must mirror server bounds");
expect(actionUiPath, actionUi, /acknowledgeNotifications\("EmployeeCase",\s*caseId\)/, "case transitions must best-effort clear stale case notifications");
expect(actionUiPath, actionUi, /acknowledgeNotifications\("CaseAction",\s*action\.id\)/, "action transitions must best-effort clear stale action notifications");
expect(actionUiPath, actionUi, /hrbp:notifications-changed/, "notification acknowledgement must refresh the notification surface");

const panelPath = "components/employee-relations-case-lifecycle-panel.tsx";
const panel = await source(panelPath);
expect(panelPath, panel, /Resolution & closure gates|Çözüm ve kapanış kontrolleri/, "workspace must expose resolution and closure governance");
expect(panelPath, panel, /EmployeeRelationsCaseLifecycleActions/, "authorized investigators must receive lifecycle controls");
expect(panelPath, panel, /focusKind[\s\S]*focusResourceId/, "workspace must surface the active deep-link focus without exposing unrestricted case data");
expect(panelPath, panel, /schemaReady/, "lifecycle panel must fail soft during schema rollout");

const actionCenterPath = "lib/lifecycle-action-center.ts";
const actionCenter = await source(actionCenterPath);
expect(actionCenterPath, actionCenter, /subjectType:\s*"CaseAction"/, "corrective-action attention items must retain action identity");
expect(actionCenterPath, actionCenter, /employee-relations\?q=.*&action=/, "corrective-action attention items must deep-link to the exact action");
expect(actionCenterPath, actionCenter, /employee-relations\?q=.*&appeal=/, "appeal attention items must deep-link to the exact appeal");
expect(actionCenterPath, actionCenter, /reviewerId:\s*ctx\.actorId/, "appeal attention must remain explicitly reviewer scoped");

const notificationPath = "lib/notification-display.ts";
const notifications = await source(notificationPath);
expect(notificationPath, notifications, /ER_CASE_STATUS_CHANGED/, "Employee Relations case notifications need human-readable presentation");
expect(notificationPath, notifications, /ER_CASE_ACTION_ASSIGNED/, "Employee Relations action assignment notifications need human-readable presentation");
expect(notificationPath, notifications, /resourceType === "EmployeeCase"[\s\S]*employee-relations\?case=/, "case notifications must deep-link into the governed case wall");
expect(notificationPath, notifications, /resourceType === "CaseAction"[\s\S]*employee-relations\?action=/, "corrective-action notifications must deep-link to the exact action");
expect(notificationPath, notifications, /EmployeeCaseAppeal|CaseAppeal/, "appeal notification routing must resolve to Employee Relations");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.case[\s\S]*search\.action[\s\S]*search\.appeal/, "Employee Relations routing must parse exact lifecycle focus parameters");
expect(modulePath, modulePage, /slug\s*===\s*"employee-relations"[\s\S]*<EmployeeRelationsCaseLifecyclePanel[\s\S]*focus=/, "Employee Relations module must mount focused case lifecycle governance");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /employee-relations-lifecycle:validate/, "Employee Relations lifecycle validator must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*employee-relations-lifecycle:validate/, "Employee Relations lifecycle validation must run before production builds");

if (failures.length) {
  console.error("Employee Relations lifecycle governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Employee Relations lifecycle governance validation passed.");
