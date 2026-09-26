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
expect(dataPath, data, /slice\(0,\s*250\)/, "the aggregate queue must be bounded");
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
expect(componentPath, component, /"workflow"\s*\|\s*"hr-service"\s*\|\s*"employee-relations"/, "the UI must understand all connected lifecycle sources");
expect(componentPath, component, /item\.action\?\.type\s*===\s*"complete-workflow"/, "direct completion must remain restricted to workflow tasks");
expect(componentPath, component, /<Link[\s\S]*href=\{item\.href\}/, "non-workflow signals must deep-link to their governed module");
expect(componentPath, component, /resourceType:\s*"WorkflowTask"/, "workflow completion must retain notification acknowledgement semantics");
expect(componentPath, component, /allowedFilters[\s\S]*critical[\s\S]*overdue[\s\S]*due-soon[\s\S]*hr-service[\s\S]*employee-relations/, "action-center deep links must be constrained to the supported filter vocabulary");
expect(componentPath, component, /normalizeFilter\(value\?\: string\)[\s\S]*:\s*"all"/, "unknown action-center view values must normalize back to all");
expect(componentPath, component, /initialTaskId[\s\S]*initialInstanceId[\s\S]*setFilter\("all"\)/, "task and instance deep links must take precedence over a filtered view");

const modulePagePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePagePath);
expect(modulePagePath, modulePage, /search\.view/, "module routing must read the lifecycle action-center view parameter");
expect(modulePagePath, modulePage, /initialFilter=\{actionView\}/, "workflow workspace must pass the requested view into the action center");

const dashboardHelperPath = "lib/dashboard-lifecycle-attention.ts";
const dashboardHelper = await source(dashboardHelperPath);
expect(dashboardHelperPath, dashboardHelper, /getServerRequestContext\(\)/, "dashboard lifecycle counts must resolve the signed actor context server-side");
expect(dashboardHelperPath, dashboardHelper, /getLifecycleActionCenterData\(ctx\)/, "dashboard counts must reuse the governed lifecycle aggregator instead of duplicating visibility logic");
expect(dashboardHelperPath, dashboardHelper, /return \{ summary: data\.summary, degraded: false \}/, "dashboard integration must expose summary counts only");
expect(dashboardHelperPath, dashboardHelper, /catch \(error\)[\s\S]*emptySummary[\s\S]*degraded: true/, "dashboard integration must fail soft without surfacing another actor or tenant's data");
reject(dashboardHelperPath, dashboardHelper, /data\.items|items:/, "dashboard helper must not expose action-level Employee Relations or HR Service details");

const dashboardPath = "components/dashboard.tsx";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getDashboardLifecycleAttentionSafe\(\)/, "Dashboard must load the actor-scoped lifecycle summary");
expect(dashboardPath, dashboard, /actionSummary\.critical/, "Dashboard must surface critical lifecycle blockers");
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
