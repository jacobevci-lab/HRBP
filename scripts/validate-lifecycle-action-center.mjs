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
expect(dataPath, data, /kind:\s*"documents"/, "document expiry signals must enter the lifecycle queue as their own source");
expect(dataPath, data, /getWorkPayActionCenterItems\(ctx\)/, "Work & Pay attention must delegate to its governed source-domain aggregator");
expect(dataPath, data, /documents:\s*items\.filter\(\(item\) => item\.kind === "documents"\)\.length/, "the summary must expose aggregate document attention");
expect(dataPath, data, /workPay:\s*items\.filter\(\(item\) => item\.kind === "work-pay"\)\.length/, "the summary must expose aggregate Work & Pay attention");
expect(dataPath, data, /slice\(0,\s*250\)/, "the aggregate queue must be bounded");
reject(dataPath, data, /objectKey|contentHash|scanMessage/, "the action center must not load private document storage or scan details");
reject(dataPath, data, /HRServiceComment|PRIVATE_NOTE|comments:\s*\{/, "the action center must not load HR Service private-note content");
reject(dataPath, data, /grounds:\s*true|decision:\s*true/, "the action center must not pull appeal narrative or decision content");

const workPayPath = "lib/work-pay-action-center.ts";
const workPay = await source(workPayPath);
expect(workPayPath, workPay, /resolveEmploymentScope\(db,\s*ctx\)/, "Work & Pay employee actions must reuse the governed employment relationship scope");
expect(workPayPath, workPay, /approvalEmploymentFilter\(scope,\s*ctx\.employmentId\)/, "time and leave approvals must explicitly remove the actor's own employment");
expect(workPayPath, workPay, /can\(ctx,\s*"time:read"\)[\s\S]*can\(ctx,\s*"time:approve"\)/, "time approval attention must require both read and approval authority");
expect(workPayPath, workPay, /status:\s*TimeEntryStatus\.SUBMITTED/, "only submitted time entries may enter the approval queue");
expect(workPayPath, workPay, /can\(ctx,\s*"leave:read"\)[\s\S]*can\(ctx,\s*"leave:approve"\)/, "leave approval attention must require both read and approval authority");
expect(workPayPath, workPay, /status:\s*LeaveRequestStatus\.PENDING/, "only pending leave requests may enter the approval queue");
expect(workPayPath, workPay, /CompensationChangeStatus\.APPROVAL[\s\S]*CompensationChangeStatus\.APPROVED/, "compensation attention must distinguish approval from effective-date apply work");
expect(workPayPath, workPay, /requestedById:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "compensation requester must be excluded from their own approval/apply signal");
expect(workPayPath, workPay, /resourceType:\s*"PayrollRun"[\s\S]*action:\s*"payroll-run\.created"/, "payroll approval attention must recover creator evidence for four-eyes enforcement");
expect(workPayPath, workPay, /creatorByRun\.get\(row\.id\) === ctx\.actorId/, "payroll creators must not receive their own approval action");
expect(workPayPath, workPay, /row\.approvedById === ctx\.actorId/, "payroll approvers must not receive the payment action for the same run");
for (const route of ["time-attendance", "leave", "compensation", "payroll"]) {
  expect(workPayPath, workPay, new RegExp(`\\/module\\/${route}\\?focus=`), `${route} attention must deep-link to an exact governed focus`);
}
expect(workPayPath, workPay, /slice\(0,\s*150\)/, "the Work & Pay subqueue must be bounded");
reject(workPayPath, workPay, /proposedAnnualBase|currentAnnualBase|grossPay|netPay|employerCost|bankToken/, "Action Center Work & Pay signals must not load salary, payroll-result or bank values");

const focusDataPath = "lib/work-pay-live-data.ts";
const focusData = await source(focusDataPath);
expect(focusDataPath, focusData, /asIdentifier\(focusId\)/, "Work & Pay focus identifiers must be bounded and validated");
expect(focusDataPath, focusData, /id:\s*focus,\s*tenantId:\s*ctx\.tenantId,\s*\.\.\.employmentIdFilter\(scope\)/, "time and leave exact focus lookups must remain tenant and employment scoped");
expect(focusDataPath, focusData, /db\.payrollRun\.findFirst\([\s\S]*id:\s*focus,\s*tenantId:\s*ctx\.tenantId/, "payroll exact focus must remain tenant scoped");
expect(focusDataPath, focusData, /focusId:\s*focusedEntry\?\.id\s*\?\?\s*null/, "time focus must only be echoed after governed resolution");
expect(focusDataPath, focusData, /focusId:\s*focusedRequest\?\.id\s*\?\?\s*null/, "leave focus must only be echoed after governed resolution");
expect(focusDataPath, focusData, /focusId:\s*focusedRun\?\.id\s*\?\?\s*null/, "payroll focus must only be echoed after governed resolution");

const compensationFocusPath = "lib/compensation-live-data.ts";
const compensationFocus = await source(compensationFocusPath);
expect(compensationFocusPath, compensationFocus, /asIdentifier\(focusId\)/, "compensation focus must be bounded and validated");
expect(compensationFocusPath, compensationFocus, /id:\s*focus,\s*tenantId:\s*ctx\.tenantId,\s*\.\.\.employmentIdFilter\(scope\)/, "compensation exact focus must retain tenant and relationship scope");
expect(compensationFocusPath, compensationFocus, /focusId:\s*focusedChange\?\.id\s*\?\?\s*null/, "compensation focus must only be echoed after governed resolution");

const routePath = "app/api/action-center/route.ts";
const route = await source(routePath);
expect(routePath, route, /getRequestContext\(request\)/, "the action center API must require authenticated request context");
expect(routePath, route, /getLifecycleActionCenterData\(ctx\)/, "the API must delegate to the scoped lifecycle aggregator");
expect(routePath, route, /cache-control[\s\S]*no-store/, "personal action queues must never be shared-cached");

const componentPath = "components/workflow-action-center.tsx";
const component = await source(componentPath);
expect(componentPath, component, /fetch\("\/api\/action-center"/, "the workspace must consume the lifecycle aggregate API");
expect(componentPath, component, /"workflow"\s*\|\s*"hr-service"\s*\|\s*"employee-relations"\s*\|\s*"documents"\s*\|\s*"work-pay"/, "the UI must understand all connected lifecycle sources");
expect(componentPath, component, /item\.action\?\.type\s*===\s*"complete-workflow"/, "direct completion must remain restricted to workflow tasks");
expect(componentPath, component, /<Link[\s\S]*href=\{item\.href\}/, "non-workflow signals must deep-link to their governed module");
expect(componentPath, component, /resourceType:\s*"WorkflowTask"/, "workflow completion must retain notification acknowledgement semantics");
expect(componentPath, component, /allowedFilters[\s\S]*critical[\s\S]*overdue[\s\S]*due-soon[\s\S]*hr-service[\s\S]*employee-relations[\s\S]*documents[\s\S]*work-pay/, "action-center deep links must be constrained to the supported filter vocabulary including Work & Pay");
expect(componentPath, component, /summary\.documents/, "the Action Center must expose the document source count without a second document query");
expect(componentPath, component, /summary\.workPay/, "the Action Center must expose the Work & Pay source count without a second domain query");
expect(componentPath, component, /normalizeFilter\(value\?\: string\)[\s\S]*:\s*"all"/, "unknown action-center view values must normalize back to all");
expect(componentPath, component, /initialTaskId[\s\S]*initialInstanceId[\s\S]*setFilter\("all"\)/, "task and instance deep links must take precedence over a filtered view");

const modulePagePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePagePath);
expect(modulePagePath, modulePage, /search\.view/, "module routing must read the lifecycle action-center view parameter");
expect(modulePagePath, modulePage, /initialFilter=\{actionView\}/, "workflow workspace must pass the requested view into the action center");
expect(modulePagePath, modulePage, /search\.focus/, "module routing must read the exact Work & Pay focus parameter");
expect(modulePagePath, modulePage, /WorkPayModulePage[\s\S]*focusId=\{workPayFocus\}/, "Work & Pay focus must be delegated to its governed workspace");

const dashboardHelperPath = "lib/dashboard-lifecycle-attention.ts";
const dashboardHelper = await source(dashboardHelperPath);
expect(dashboardHelperPath, dashboardHelper, /getServerRequestContext\(\)/, "dashboard lifecycle counts must resolve the signed actor context server-side");
expect(dashboardHelperPath, dashboardHelper, /getLifecycleActionCenterData\(ctx\)/, "dashboard counts must reuse the governed lifecycle aggregator instead of duplicating visibility logic");
expect(dashboardHelperPath, dashboardHelper, /workPay:\s*number/, "dashboard summary contract must include aggregate Work & Pay attention");
expect(dashboardHelperPath, dashboardHelper, /return \{ summary: data\.summary, degraded: false \}/, "dashboard integration must expose summary counts only");
expect(dashboardHelperPath, dashboardHelper, /catch \(error\)[\s\S]*emptySummary[\s\S]*degraded: true/, "dashboard integration must fail soft without surfacing another actor or tenant's data");
reject(dashboardHelperPath, dashboardHelper, /data\.items|items:/, "dashboard helper must not expose action-level Employee Relations, HR Service, document or Work & Pay details");

const dashboardPath = "components/dashboard.tsx";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getDashboardLifecycleAttentionSafe\(\)/, "Dashboard must load the actor-scoped lifecycle summary");
expect(dashboardPath, dashboard, /actionSummary\.critical/, "Dashboard must surface critical lifecycle blockers");
expect(dashboardPath, dashboard, /actionSummary\.overdue/, "Dashboard must surface overdue lifecycle blockers");
expect(dashboardPath, dashboard, /actionSummary\.hrService/, "Dashboard must connect HR Service attention into the lifecycle card");
expect(dashboardPath, dashboard, /actionSummary\.employeeRelations/, "Dashboard must connect authorized Employee Relations attention into the lifecycle card");
expect(dashboardPath, dashboard, /actionSummary\.workPay/, "Dashboard must connect aggregate Work & Pay approval attention into the lifecycle card");
expect(dashboardPath, dashboard, /view=work-pay/, "Dashboard Work & Pay attention must deep-link to the governed Action Center filter");
expect(dashboardPath, dashboard, /actionDataDegraded[\s\S]*upcomingStarters/, "Dashboard must retain safe fallback priorities if actor-specific lifecycle aggregation fails");
reject(dashboardPath, dashboard, /actionSummary\.(items|records|cases)/, "Dashboard must consume only lifecycle summary counts, never action-level restricted content");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /lifecycle-action-center:validate/, "lifecycle action center validation must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*lifecycle-action-center:validate/, "lifecycle action center validation must run before production builds");

if (failures.length) {
  console.error("Lifecycle action center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Lifecycle action center validation passed.");
