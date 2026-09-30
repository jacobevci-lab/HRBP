import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const continuityPath = "lib/policy-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getRecruitingLifecycleActionCenterData\(ctx\)/, "Policy continuity must extend the current top-level Recruiting lifecycle chain");
expect(continuityPath, continuity, /can\(ctx,\s*"policies:approve"\)/, "policy review attention must require approval authority");
expect(continuityPath, continuity, /status:\s*PolicyStatus\.REVIEW/, "only policy versions awaiting review may enter reviewer attention");
expect(continuityPath, continuity, /ownerId:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "policy owners must not receive self-approval attention");
expect(continuityPath, continuity, /can\(ctx,\s*"policies:acknowledge"\)/, "employee acknowledgement attention must require acknowledgement authority");
expect(continuityPath, continuity, /employmentId:\s*ctx\.employmentId/, "acknowledgement attention must remain bound to trusted employment context");
expect(continuityPath, continuity, /PolicyAssignmentStatus\.PENDING[\s\S]*PolicyAssignmentStatus\.OVERDUE/, "only pending or overdue assignments may enter acknowledgement attention");
expect(continuityPath, continuity, /status:\s*PolicyStatus\.PUBLISHED/, "acknowledgement attention must reference published policies only");
expect(continuityPath, continuity, /\/module\/policies\?policy=/, "policy attention must deep-link to the governed Policy workspace");
expect(continuityPath, continuity, /kind:\s*"policies"/, "Policies must be a first-class Action Center source");
expect(continuityPath, continuity, /policies:\s*items\.filter\(\(item\) => item\.kind === "policies"\)\.length/, "summary must expose aggregate Policy attention");
reject(continuityPath, continuity, /contentMarkdown|contentHash|compensatingControl/, "central Policy attention must not load policy body or exception narratives");

const apiPath = "app/api/action-center/route.ts";
const api = await source(apiPath);
expect(apiPath, api, /policy-action-center-continuity/, "Action Center API must use Policy continuity");
expect(apiPath, api, /cache-control[\s\S]*no-store/, "personal action queues must remain non-cacheable");

const uiPath = "components/workflow-action-center.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /ActionKind[\s\S]*"policies"/, "Action Center UI must understand Policy items");
expect(uiPath, ui, /allowedFilters[\s\S]*"policies"/, "Policies must be an allow-listed Action Center filter");
expect(uiPath, ui, /summary\.policies/, "Action Center must expose the aggregate Policy source count");
expect(uiPath, ui, /filter === "policies"/, "Action Center must provide a Policy source filter");
expect(uiPath, ui, /href=\{item\.href\}/, "Policy attention must stay deep-link only in the central queue");

const reviewRoutePath = "app/api/policies/[id]/review/route.ts";
const reviewRoute = await source(reviewRoutePath);
expect(reviewRoutePath, reviewRoute, /can\(ctx,\s*"policies:approve"\)/, "review decisions must remain in the owning Policy route");
expect(reviewRoutePath, reviewRoute, /current\.ownerId === ctx\.actorId/, "Policy route must preserve four-eyes self-approval prevention");

const ackRoutePath = "app/api/policies/[id]/acknowledgements/route.ts";
const ackRoute = await source(ackRoutePath);
expect(ackRoutePath, ackRoute, /ctx\.employmentId/, "acknowledgement mutation must stay bound to trusted employment context");
expect(ackRoutePath, ackRoute, /PolicyStatus\.PUBLISHED/, "acknowledgement mutation must stay limited to published policies");

const modulePagePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePagePath);
expect(modulePagePath, modulePage, /search\.policy/, "Policy deep links must accept an exact policy focus id");
expect(modulePagePath, modulePage, /search\.mode/, "Policy deep links must carry the requested governance mode");
expect(modulePagePath, modulePage, /policyLifecycleQuery/, "Policy focus must be routed through the governed workspace query");

const liveWorkspacePath = "components/employee-services-live-workspace.tsx";
const liveWorkspace = await source(liveWorkspacePath);
expect(liveWorkspacePath, liveWorkspace, /focusVisible/, "Policy workspace must verify exact focus remains visible in governed scope");
expect(liveWorkspacePath, liveWorkspace, /failed closed/, "invalid Policy focus must fail closed without broadening scope");
expect(liveWorkspacePath, liveWorkspace, /data-policy-id/, "Policy rows must expose exact focus anchors");
expect(liveWorkspacePath, liveWorkspace, /PolicyAcknowledgementAction/, "self-service Policy workspace must expose governed acknowledgement action");
expect(liveWorkspacePath, liveWorkspace, /PolicyFocusScroller/, "exact Policy focus must scroll into view when authorized");

const acknowledgementActionPath = "components/policy-acknowledgement-action.tsx";
const acknowledgementAction = await source(acknowledgementActionPath);
expect(acknowledgementActionPath, acknowledgementAction, /\/acknowledgements/, "Policy acknowledgement UI must call the owning domain route");
expect(acknowledgementActionPath, acknowledgementAction, /hrbp:lifecycle-actions-changed/, "successful acknowledgement must invalidate lifecycle attention");
expect(acknowledgementActionPath, acknowledgementAction, /hrbp:notifications-changed/, "successful acknowledgement must refresh notification state");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getPolicyLifecycleActionCenterData/, "Dashboard must reuse the same governed Policy continuity source");
expect(dashboardPath, dashboard, /policies:\s*number/, "Dashboard summary must carry aggregate Policy attention only");
reject(dashboardPath, dashboard, /contentMarkdown|contentHash|policy\.title|\.items/, "Dashboard must not receive Policy record detail");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /getPolicyLifecycleActionCenterData/, "Analytics must reuse the same governed Policy continuity source");
expect(analyticsPath, analytics, /policies:\s*source\.summary\.policies/, "Analytics must project the Policy aggregate only");
expect(analyticsPath, analytics, /aggregateOnly:\s*true/, "Analytics privacy contract must remain aggregate-only");
reject(analyticsPath, analytics, /contentMarkdown|contentHash|policy\.title|\.items/, "Analytics must not project Policy detail");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /policy-action-center:validate/, "Policy continuity validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*policy-action-center:validate/, "Policy continuity validation must run before production builds");

if (failures.length) {
  console.error("Policy action center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Policy action center validation passed.");
