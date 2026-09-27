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
expect(dataPath, data, /documents:\s*items\.filter\(\(item\) => item\.kind === "documents"\)\.length/, "the summary must expose aggregate document attention");
expect(dataPath, data, /can\(ctx,\s*"leave:approve"\)/, "leave approval attention must require approval authority");
expect(dataPath, data, /can\(ctx,\s*"time:approve"\)/, "time approval attention must require approval authority");
expect(dataPath, data, /resolveEmploymentScope\(db,\s*ctx\)/, "work-pay approvals must reuse the relationship-scoped employment graph");
expect(dataPath, data, /LeaveRequestStatus\.PENDING/, "only pending leave decisions may enter the approval queue");
expect(dataPath, data, /TimeEntryStatus\.SUBMITTED/, "only submitted time entries may enter the approval queue");
expect(dataPath, data, /employmentId:[\s\S]*not:\s*ctx\.employmentId/, "work-pay approval attention must exclude the actor's own employment record");
expect(dataPath, data, /href:\s*`\/module\/leave\?request=/, "leave approvals must deep-link to the governed leave record");
expect(dataPath, data, /href:\s*`\/module\/time-attendance\?entry=/, "time approvals must deep-link to the governed time record");
expect(dataPath, data, /leave:\s*items\.filter\(\(item\) => item\.kind === "leave"\)\.length/, "summary must expose aggregate leave approvals");
expect(dataPath, data, /timeAttendance:\s*items\.filter\(\(item\) => item\.kind === "time-attendance"\)\.length/, "summary must expose aggregate time approvals");
expect(dataPath, data, /slice\(0,\s*250\)/, "the aggregate queue must be bounded");
reject(dataPath, data, /objectKey|contentHash|scanMessage/, "the action center must not load private document storage or scan details");
reject(dataPath, data, /HRServiceComment|PRIVATE_NOTE|comments:\s*\{/, "the action center must not load HR Service private-note content");
reject(dataPath, data, /grounds:\s*true|decision:\s*true/, "the action center must not pull appeal narrative or decision content");

const routePath = "app/api/action-center/route.ts";
const route = await source(routePath);
expect(routePath, route, /getRequestContext\(request\)/, "the action center API must require authenticated request context");
expect(routePath, route, /getLifecycleActionCenterData\(ctx\)/, "the API must delegate to the scoped lifecycle aggregator");
expect(routePath, route, /cache-control[\s\S]*no-store/, "personal action queues must never be shared-cached");

const componentPath = "components/workflow-action-center.tsx";
const component = await source(componentPath);
expect(componentPath, component, /fetch\("\/api\/action-center"/, "the workspace must consume the lifecycle aggregate API");
expect(componentPath, component, /"workflow"\s*\|\s*"hr-service"\s*\|\s*"employee-relations"\s*\|\s*"documents"\s*\|\s*"leave"\s*\|\s*"time-attendance"/, "the UI must understand all connected lifecycle sources");
expect(componentPath, component, /item\.action\?\.type\s*===\s*"complete-workflow"/, "direct completion must remain restricted to workflow tasks");
expect(componentPath, component, /<Link[\s\S]*href=\{item\.href\}/, "non-workflow signals must deep-link to their governed module");
expect(componentPath, component, /resourceType:\s*"WorkflowTask"/, "workflow completion must retain notification acknowledgement semantics");
expect(componentPath, component, /allowedFilters[\s\S]*critical[\s\S]*overdue[\s\S]*due-soon[\s\S]*hr-service[\s\S]*employee-relations[\s\S]*documents[\s\S]*leave[\s\S]*time-attendance/, "action-center deep links must be constrained to the supported filter vocabulary");
expect(componentPath, component, /summary\.documents/, "the Action Center must expose the document source count without a second document query");
expect(componentPath, component, /summary\.leave/, "the Action Center must expose governed leave approval counts");
expect(componentPath, component, /summary\.timeAttendance/, "the Action Center must expose governed time approval counts");
expect(componentPath, component, /normalizeFilter\(value\?\: string\)[\s\S]*:\s*"all"/, "unknown action-center view values must normalize back to all");
expect(componentPath, component, /initialTaskId[\s\S]*initialInstanceId[\s\S]*setFilter\("all"\)/, "task and instance deep links must take precedence over a filtered view");

const modulePagePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePagePath);
expect(modulePagePath, modulePage, /search\.view/, "module routing must read the lifecycle action-center view parameter");
expect(modulePagePath, modulePage, /search\.entry/, "module routing must accept exact time-entry focus");
expect(modulePagePath, modulePage, /slug === "leave" \? requestFocus[\s\S]*slug === "time-attendance" \? entryFocus/, "leave and time deep links must stay domain-specific");
expect(modulePagePath, modulePage, /focusId=\{workPayFocus\}/, "work-pay modules must receive the exact governed focus identifier");
expect(modulePagePath, modulePage, /initialFilter=\{actionView\}/, "workflow workspace must pass the requested view into the action center");

const liveDataPath = "lib/work-pay-live-data.ts";
const liveData = await source(liveDataPath);
expect(liveDataPath, liveData, /boundedFocusId[\s\S]*trim\(\)\.slice\(0,\s*160\)/, "exact work-pay focus identifiers must be bounded");
expect(liveDataPath, liveData, /findFirst\([\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*id:\s*boundedFocusId[\s\S]*employmentIdFilter\(scope\)/, "exact work-pay focus must remain inside the same employment scope");
expect(liveDataPath, liveData, /focusVisible:\s*Boolean\(focusedEntry\)/, "time deep links must fail closed when the exact row is inaccessible");
expect(liveDataPath, liveData, /focusVisible:\s*Boolean\(focusedRequest\)/, "leave deep links must fail closed when the exact row is inaccessible");
reject(liveDataPath, liveData, /findUnique\([\s\S]*boundedFocusId/, "exact work-pay focus must not use an unscoped primary-key fallback");

const leaveDecisionPath = "components/leave-decision-buttons.tsx";
const leaveDecision = await source(leaveDecisionPath);
expect(leaveDecisionPath, leaveDecision, /resourceType:\s*"LeaveRequest"/, "successful leave decisions must clear the matching notification best-effort");
expect(leaveDecisionPath, leaveDecision, /if \(!response\.ok\) throw[\s\S]*acknowledgeLeaveNotification/, "notification acknowledgement must happen only after a successful leave decision");

const timeDecisionPath = "components/time-entry-transition-buttons.tsx";
const timeDecision = await source(timeDecisionPath);
expect(timeDecisionPath, timeDecision, /resourceType:\s*"TimeEntry"/, "successful time decisions must clear the matching notification best-effort");
expect(timeDecisionPath, timeDecision, /status === "APPROVED" \|\| status === "REJECTED"/, "time notification cleanup must only follow approval decisions");

const dashboardHelperPath = "lib/dashboard-lifecycle-attention.ts";
const dashboardHelper = await source(dashboardHelperPath);
expect(dashboardHelperPath, dashboardHelper, /getServerRequestContext\(\)/, "dashboard lifecycle counts must resolve the signed actor context server-side");
expect(dashboardHelperPath, dashboardHelper, /getLifecycleActionCenterData\(ctx\)/, "dashboard counts must reuse the governed lifecycle aggregator instead of duplicating visibility logic");
expect(dashboardHelperPath, dashboardHelper, /return \{ summary: data\.summary, degraded: false \}/, "dashboard integration must expose summary counts only");
expect(dashboardHelperPath, dashboardHelper, /catch \(error\)[\s\S]*emptySummary[\s\S]*degraded: true/, "dashboard integration must fail soft without surfacing another actor or tenant's data");
reject(dashboardHelperPath, dashboardHelper, /data\.items|items:/, "dashboard helper must not expose action-level restricted content");

const dashboardPath = "components/dashboard.tsx";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getDashboardLifecycleAttentionSafe\(\)/, "Dashboard must load the actor-scoped lifecycle summary");
expect(dashboardPath, dashboard, /actionSummary\.critical/, "Dashboard must surface critical lifecycle blockers through the shared aggregate");
expect(dashboardPath, dashboard, /actionSummary\.overdue/, "Dashboard must surface overdue lifecycle blockers");
expect(dashboardPath, dashboard, /actionSummary\.hrService/, "Dashboard must connect HR Service attention into the lifecycle card");
expect(dashboardPath, dashboard, /actionSummary\.employeeRelations/, "Dashboard must connect authorized Employee Relations attention into the lifecycle card");
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
