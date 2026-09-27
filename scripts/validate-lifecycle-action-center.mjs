import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const dataPath = "lib/lifecycle-action-center.ts";
const data = await source(dataPath);
expect(dataPath, data, /tenantId:\s*ctx\.tenantId/, "every lifecycle source must remain tenant scoped");
expect(dataPath, data, /hrServiceRequestWhere\(db,\s*ctx\)/, "HR Service signals must reuse the governed request visibility scope");
expect(dataPath, data, /isHRServiceSelfServiceRole/, "employee and manager service signals must stay self-service aware");
expect(dataPath, data, /visibleHRServiceQueueKeys/, "service operations signals must respect delegated queue membership");
expect(dataPath, data, /ownerUserId:\s*ctx\.actorId[\s\S]*assignments:\s*\{\s*some:/, "Employee Relations signals must preserve Case Wall ownership or assignment scope");
expect(dataPath, data, /ownerId:\s*ctx\.actorId/, "Employee Relations corrective actions must be owned by the current actor");
expect(dataPath, data, /reviewerId:\s*ctx\.actorId/, "Employee Relations appeals must be explicitly assigned to the current reviewer");
expect(dataPath, data, /CaseActionStatus\.OPEN[\s\S]*CaseActionStatus\.IN_PROGRESS/, "only active case actions may enter the queue");
expect(dataPath, data, /ServiceRequestStatus\.WAITING_EMPLOYEE/, "self-service response blockers must surface in the queue");
expect(dataPath, data, /ServicePriority\.HIGH[\s\S]*ServicePriority\.CRITICAL/, "high-risk service requests must be eligible for operational attention");
expect(dataPath, data, /can\(ctx,\s*"documents:read"\)/, "document attention must require document read authority");
expect(dataPath, data, /documentVisibilityWhere\(db,\s*ctx\)/, "document attention must reuse the governed document visibility scope");
expect(dataPath, data, /expiresAt:\s*\{\s*not:\s*null,\s*lte:\s*horizon\s*\}/, "document attention must be limited to expiry-bearing records in the bounded horizon");
expect(dataPath, data, /href:\s*`\/module\/documents\?document=/, "document actions must deep-link through the governed exact-document lifecycle route");
expect(dataPath, data, /can\(ctx,\s*"leave:approve"\)/, "leave approval attention must require approval authority");
expect(dataPath, data, /can\(ctx,\s*"time:approve"\)/, "time approval attention must require approval authority");
expect(dataPath, data, /LeaveRequestStatus\.PENDING/, "only pending leave decisions may enter the approval queue");
expect(dataPath, data, /TimeEntryStatus\.SUBMITTED/, "only submitted time entries may enter the approval queue");
expect(dataPath, data, /employmentId:[\s\S]*not:\s*ctx\.employmentId/, "leave/time approval attention must exclude the actor's own employment record");
expect(dataPath, data, /href:\s*`\/module\/leave\?request=/, "leave approvals must deep-link to the governed leave record");
expect(dataPath, data, /href:\s*`\/module\/time-attendance\?entry=/, "time approvals must deep-link to the governed time record");
expect(dataPath, data, /can\(ctx,\s*"compensation:read"\)/, "compensation attention must require restricted read authority");
expect(dataPath, data, /can\(ctx,\s*"compensation:approve"\)/, "compensation approval attention must require approval authority");
expect(dataPath, data, /can\(ctx,\s*"compensation:apply"\)/, "compensation apply attention must require apply authority");
expect(dataPath, data, /CompensationChangeStatus\.APPROVAL/, "compensation approval state must enter the governed queue");
expect(dataPath, data, /CompensationChangeStatus\.APPROVED/, "approved compensation changes must enter apply attention");
expect(dataPath, data, /requestedById:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "compensation attention must preserve requester four-eyes separation");
expect(dataPath, data, /href:\s*`\/module\/compensation\?change=/, "compensation attention must deep-link to the restricted domain workspace");
expect(dataPath, data, /can\(ctx,\s*"payroll:read"\)/, "payroll attention must require restricted payroll read authority");
expect(dataPath, data, /can\(ctx,\s*"payroll:approve"\)/, "payroll approval attention must require approval authority");
expect(dataPath, data, /can\(ctx,\s*"payroll:pay"\)/, "payroll payment attention must require payment authority");
expect(dataPath, data, /PayrollRunStatus\.APPROVAL/, "payroll approval state must enter the governed queue");
expect(dataPath, data, /PayrollRunStatus\.APPROVED/, "approved payroll runs must enter payment attention");
expect(dataPath, data, /action:\s*"payroll-run\.created"/, "payroll approval attention must resolve run creator evidence");
expect(dataPath, data, /creators\.get\(row\.id\) !== ctx\.actorId/, "payroll creator must be excluded from approval attention");
expect(dataPath, data, /row\.approvedById !== ctx\.actorId/, "payroll approver must be excluded from payment attention");
expect(dataPath, data, /href:\s*`\/module\/payroll\?run=/, "payroll attention must deep-link to the restricted payroll workspace");
expect(dataPath, data, /resolveEmploymentScope\(db,\s*ctx\)/, "relationship-scoped work-pay domains must reuse the employment graph");
for (const counter of ["documents", "leave", "compensation", "payroll"]) {
  expect(dataPath, data, new RegExp(`${counter}:\\s*items\\.filter\\(\\(item\\) => item\\.kind === "${counter}"\\)\\.length`), `summary must expose aggregate ${counter} attention`);
}
expect(dataPath, data, /timeAttendance:\s*items\.filter\(\(item\) => item\.kind === "time-attendance"\)\.length/, "summary must expose aggregate time approvals");
expect(dataPath, data, /slice\(0,\s*300\)/, "the aggregate queue must remain bounded");
reject(dataPath, data, /objectKey|contentHash|scanMessage/, "the action center must not load private document storage or scan details");
reject(dataPath, data, /HRServiceComment|PRIVATE_NOTE|comments:\s*\{/, "the action center must not load HR Service private-note content");
reject(dataPath, data, /grounds:\s*true|decision:\s*true/, "the action center must not pull appeal narrative or decision content");
reject(dataPath, data, /currentAnnualBase|proposedAnnualBase|annualBase|grossPay|netPay|employerCost/, "the aggregate action queue must not load compensation amounts or payroll results");

const routePath = "app/api/action-center/route.ts";
const route = await source(routePath);
expect(routePath, route, /getRequestContext\(request\)/, "the action center API must require authenticated request context");
expect(routePath, route, /getLifecycleActionCenterData\(ctx\)/, "the API must delegate to the scoped lifecycle aggregator");
expect(routePath, route, /cache-control[\s\S]*no-store/, "personal action queues must never be shared-cached");

const componentPath = "components/workflow-action-center.tsx";
const component = await source(componentPath);
expect(componentPath, component, /fetch\("\/api\/action-center"/, "the workspace must consume the lifecycle aggregate API");
for (const kind of ["workflow", "hr-service", "employee-relations", "documents", "leave", "time-attendance", "compensation", "payroll"]) {
  expect(componentPath, component, new RegExp(`"${kind}"`), `the UI must understand ${kind} lifecycle attention`);
}
expect(componentPath, component, /item\.action\?\.type\s*===\s*"complete-workflow"/, "direct completion must remain restricted to workflow tasks");
expect(componentPath, component, /<Link[\s\S]*href=\{item\.href\}/, "non-workflow signals must deep-link to their governed module");
expect(componentPath, component, /resourceType:\s*"WorkflowTask"/, "workflow completion must retain notification acknowledgement semantics");
expect(componentPath, component, /allowedFilters[\s\S]*compensation[\s\S]*payroll/, "compensation and payroll must be constrained supported Action Center filters");
expect(componentPath, component, /summary\.compensation/, "Action Center must expose compensation attention counts");
expect(componentPath, component, /summary\.payroll/, "Action Center must expose payroll attention counts");
expect(componentPath, component, /normalizeFilter\(value\?\: string\)[\s\S]*:\s*"all"/, "unknown action-center view values must normalize back to all");
expect(componentPath, component, /initialTaskId[\s\S]*initialInstanceId[\s\S]*setFilter\("all"\)/, "task and instance deep links must take precedence over a filtered view");

const modulePagePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePagePath);
expect(modulePagePath, modulePage, /search\.view/, "module routing must read the lifecycle action-center view parameter");
expect(modulePagePath, modulePage, /search\.entry/, "module routing must accept exact time-entry focus");
expect(modulePagePath, modulePage, /search\.change/, "module routing must accept exact compensation focus");
expect(modulePagePath, modulePage, /search\.run/, "module routing must accept exact payroll-run focus");
expect(modulePagePath, modulePage, /slug === "compensation"[\s\S]*compensationFocus[\s\S]*slug === "payroll"[\s\S]*payrollFocus/, "work-pay deep links must stay domain-specific");
expect(modulePagePath, modulePage, /focusId=\{workPayFocus\}/, "work-pay modules must receive the exact governed focus identifier");

const liveDataPath = "lib/work-pay-live-data.ts";
const liveData = await source(liveDataPath);
expect(liveDataPath, liveData, /boundedFocusId[\s\S]*trim\(\)\.slice\(0,\s*160\)/, "exact work-pay focus identifiers must be bounded");
expect(liveDataPath, liveData, /focusVisible:\s*Boolean\(focusedEntry\)/, "time deep links must fail closed when inaccessible");
expect(liveDataPath, liveData, /focusVisible:\s*Boolean\(focusedRequest\)/, "leave deep links must fail closed when inaccessible");
expect(liveDataPath, liveData, /focusVisible:\s*Boolean\(focusedRun\)/, "payroll deep links must fail closed when inaccessible");
expect(liveDataPath, liveData, /payrollRun\.findFirst\([\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*id:\s*boundedFocusId/, "payroll exact focus must remain tenant scoped");
reject(liveDataPath, liveData, /findUnique\([\s\S]*boundedFocusId/, "exact work-pay focus must not use an unscoped primary-key fallback");

const compensationDataPath = "lib/compensation-live-data.ts";
const compensationData = await source(compensationDataPath);
expect(compensationDataPath, compensationData, /focusId\?\.trim\(\)\.slice\(0,\s*160\)/, "compensation exact focus must be bounded");
expect(compensationDataPath, compensationData, /compensationChange\.findFirst\([\s\S]*id:\s*boundedFocusId[\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*employmentIdFilter\(scope\)/, "compensation exact focus must retain tenant and employment scope");
expect(compensationDataPath, compensationData, /focusVisible:\s*Boolean\(focusedChange\)/, "compensation exact focus must fail closed when inaccessible");

const compensationDecisionPath = "components/compensation-decision-buttons.tsx";
const compensationDecision = await source(compensationDecisionPath);
expect(compensationDecisionPath, compensationDecision, /resourceType:\s*"CompensationChange"/, "successful compensation actions must clear matching notifications best-effort");
expect(compensationDecisionPath, compensationDecision, /if \(!response\.ok\) throw[\s\S]*acknowledgeCompensationNotification/, "compensation notification acknowledgement must follow a successful mutation");

const payrollDecisionPath = "components/payroll-transition-button.tsx";
const payrollDecision = await source(payrollDecisionPath);
expect(payrollDecisionPath, payrollDecision, /resourceType:\s*"PayrollRun"/, "successful payroll controls must clear matching notifications best-effort");
expect(payrollDecisionPath, payrollDecision, /next === "APPROVED" \|\| next === "PAID"/, "payroll notification cleanup must follow approval or payment completion only");

const dashboardHelperPath = "lib/dashboard-lifecycle-attention.ts";
const dashboardHelper = await source(dashboardHelperPath);
expect(dashboardHelperPath, dashboardHelper, /getServerRequestContext\(\)/, "dashboard lifecycle counts must resolve the signed actor context server-side");
expect(dashboardHelperPath, dashboardHelper, /getLifecycleActionCenterData\(ctx\)/, "dashboard counts must reuse the governed lifecycle aggregator instead of duplicating visibility logic");
expect(dashboardHelperPath, dashboardHelper, /compensation:\s*0[\s\S]*payroll:\s*0/, "dashboard safe fallback must include compensation and payroll counters");
expect(dashboardHelperPath, dashboardHelper, /return \{ summary: data\.summary, degraded: false \}/, "dashboard integration must expose summary counts only");
reject(dashboardHelperPath, dashboardHelper, /data\.items|items:/, "dashboard helper must not expose action-level restricted content");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /lifecycle-action-center:validate/, "lifecycle action center validation must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*lifecycle-action-center:validate/, "lifecycle action center validation must run before production builds");

if (failures.length) {
  console.error("Lifecycle action center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Lifecycle action center validation passed.");
