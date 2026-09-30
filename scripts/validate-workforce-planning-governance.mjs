import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const routePath = "app/api/workforce-planning/scenarios/[id]/review/route.ts";
const route = await source(routePath);
expect(routePath, route, /workforce-plan:approve/, "independent approval must use a dedicated capability");
expect(routePath, route, /current\.ownerId === ctx\.actorId/, "scenario owners must not approve their own plan");
expect(routePath, route, /WorkforceScenarioStatus\.REVIEW/, "approval must require REVIEW state");
expect(routePath, route, /WorkforceScenarioStatus\.APPROVED/, "lock must require prior APPROVED state");
expect(routePath, route, /no implicit workforce mutation/, "locking must explicitly preserve separation from authoritative workforce mutation");

const continuityPath = "lib/privacy-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getPolicyLifecycleActionCenterData\(ctx\)/, "Workforce Planning must extend the current Policy continuity chain");
expect(continuityPath, continuity, /resolveEmploymentScope/, "review attention must respect relationship scope");
expect(continuityPath, continuity, /status:\s*WorkforceScenarioStatus\.REVIEW/, "only review-ready scenarios may enter attention");
expect(continuityPath, continuity, /ownerId:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "Action Center must preserve four-eyes self-review prevention");
expect(continuityPath, continuity, /workforcePlanning:\s*items\.filter/, "summary must expose aggregate Workforce Planning attention");
reject(continuityPath, continuity, /avgAnnualCost|currentFte|plannedFte|skillsRequired|costDelta/, "central attention must not load planning cost, FTE or skill detail");

const uiPath = "components/workflow-action-center.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /"workforce-planning"/, "Action Center must expose Workforce Planning as a source");
expect(uiPath, ui, /summary\.workforcePlanning/, "Action Center must show aggregate Workforce Planning attention");

const livePath = "components/governance-planning-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /data-workforce-scenario-id/, "exact scenario focus must be anchored in the governed workspace");
expect(livePath, live, /focusVisible/, "invalid scenario focus must fail closed");
expect(livePath, live, /WorkforceScenarioActions/, "scenario lifecycle actions must remain in the owning workspace");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.scenario/, "scenario deep links must carry an exact focus id");
expect(modulePath, modulePage, /GovernancePlanningModulePage[\s\S]*focusId/, "exact scenario focus must reach the governance workspace");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getPrivacyLifecycleActionCenterData/, "Dashboard must use the current top-level continuity source");
expect(dashboardPath, dashboard, /workforcePlanning:\s*number/, "Dashboard must carry aggregate Workforce Planning attention");
reject(dashboardPath, dashboard, /costDelta|plannedFte|\.items/, "Dashboard must not receive scenario details");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /getPrivacyLifecycleActionCenterData/, "Analytics must use the current top-level continuity source");
expect(analyticsPath, analytics, /workforcePlanning:\s*source\.summary\.workforcePlanning/, "Analytics must project only the Workforce Planning aggregate");
expect(analyticsPath, analytics, /aggregateOnly:\s*true/, "Analytics lifecycle continuity must remain aggregate-only");

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /workforce-plan:approve/, "authorization must define the approval capability");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /workforce-planning-governance:validate/, "Workforce Planning validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*workforce-planning-governance:validate/, "Workforce Planning validator must run before production builds");

if (failures.length) {
  console.error("Workforce Planning governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Workforce Planning governance validation passed.");
