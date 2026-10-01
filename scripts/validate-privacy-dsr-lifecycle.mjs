import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const routePath = "app/api/privacy/dsrs/[id]/lifecycle/route.ts";
const route = await source(routePath);
expect(routePath, route, /privacy:write/, "DSR lifecycle transitions must require privacy write authority");
expect(routePath, route, /current\.ownerId !== ctx\.actorId/, "DSR lifecycle must remain owner-bound");
expect(routePath, route, /BEGIN_VERIFICATION[\s\S]*IDENTITY_VERIFICATION/, "DSR lifecycle must enter identity verification explicitly");
expect(routePath, route, /VERIFY[\s\S]*IDENTITY_VERIFICATION[\s\S]*IN_PROGRESS/, "DSR processing must start only after identity verification");
expect(routePath, route, /verifiedAt:\s*action === "VERIFY" \? now : current\.verifiedAt/, "verifiedAt evidence must be written only when verification completes");
expect(routePath, route, /IN_PROGRESS/, "DSR lifecycle must preserve in-progress state");
expect(routePath, route, /WAITING/, "DSR lifecycle must support waiting/resume state");
expect(routePath, route, /COMPLETED/, "DSR lifecycle must support completion");
expect(routePath, route, /REJECTED/, "DSR lifecycle must support rejection");
expect(routePath, route, /CANCELLED/, "DSR lifecycle must support cancellation");
expect(routePath, route, /rejectionReason/, "rejection must preserve a governed reason");
expect(routePath, route, /DataClassification\.RESTRICTED/, "DSR lifecycle audit evidence must remain restricted");

const continuityPath = "lib/privacy-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getWorkforcePlanningLifecycleActionCenterData\(ctx\)/, "Privacy must extend the current Workforce Planning continuity chain");
expect(continuityPath, continuity, /ownerId:\s*ctx\.actorId/, "Privacy attention must be bound to the signed DSR owner");
expect(continuityPath, continuity, /status:\s*\{\s*in:\s*openStatuses/, "only open DSR states may enter attention");
expect(continuityPath, continuity, /\/module\/privacy\?dsr=/, "DSR attention must deep-link to exact governed privacy focus");
expect(continuityPath, continuity, /privacy:\s*items\.filter/, "summary must expose aggregate Privacy attention");
expect(continuityPath, continuity, /type:\s*"begin-dsr-verification"[\s\S]*type:\s*"verify-dsr"[\s\S]*type:\s*"wait-dsr"[\s\S]*type:\s*"resume-dsr"/, "DSR attention must expose bounded state-specific owner actions");
reject(continuityPath, continuity, /subjectPersonId|rejectionReason/, "central Privacy attention must not load data-subject identity or rejection narrative");

const uiPath = "components/workflow-action-center.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /"privacy"/, "Action Center must expose Privacy as a source");
expect(uiPath, ui, /summary\.privacy/, "Action Center must surface aggregate Privacy attention");
expect(uiPath, ui, /item\.action\.type === "begin-dsr-verification"[\s\S]*BEGIN_VERIFICATION/, "received DSRs must use the governed lifecycle route to begin verification");
expect(uiPath, ui, /item\.action\.type === "verify-dsr"[\s\S]*action:\s*"VERIFY"/, "verification completion must use the governed DSR lifecycle route");
expect(uiPath, ui, /item\.action\.type === "wait-dsr"[\s\S]*action:\s*"WAIT"/, "in-progress DSRs must use the governed lifecycle route to enter waiting");
expect(uiPath, ui, /item\.action\.type === "resume-dsr"[\s\S]*action:\s*"RESUME"/, "waiting DSRs must use the governed lifecycle route to resume");
expect(uiPath, ui, /resourceType:\s*"DataSubjectRequest"/, "DSR quick actions must clear matching notifications best-effort");
expect(uiPath, ui, /window\.confirm\(copy\.confirm\)/, "DSR quick actions must require explicit confirmation");

const livePath = "components/governance-planning-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /data-dsr-id/, "Privacy workspace must anchor exact DSR focus");
expect(livePath, live, /privacyFocusVisible/, "invalid DSR focus must fail closed");
expect(livePath, live, /DSRLifecycleActions/, "DSR lifecycle actions must stay in the owning Privacy workspace");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.dsr/, "Privacy deep links must accept an exact DSR focus id");
expect(modulePath, modulePage, /slug === "privacy" \? \(privacyAssessmentFocus \|\| privacyTransferFocus \|\| dsrFocus\)/, "Privacy focus must route DSR and assurance records only into the Privacy workspace");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getWorkflowDefinitionLifecycleActionCenterData/, "Dashboard must use the current top-level continuity source that preserves Privacy");
expect(dashboardPath, dashboard, /privacy:\s*number/, "Dashboard must carry aggregate Privacy attention only");
reject(dashboardPath, dashboard, /subjectPersonId|rejectionReason|\.items/, "Dashboard must not receive DSR detail");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /getWorkflowDefinitionLifecycleActionCenterData/, "Analytics must use the current top-level continuity source that preserves Privacy");
expect(analyticsPath, analytics, /privacy:\s*source\.summary\.privacy/, "Analytics must project only the Privacy aggregate");
expect(analyticsPath, analytics, /aggregateOnly:\s*true/, "Analytics lifecycle continuity must remain aggregate-only");

const analyticsPagePath = "components/analytics-module-page.tsx";
const analyticsPage = await source(analyticsPagePath);
expect(analyticsPagePath, analyticsPage, /continuity\.summary\.privacy/, "Analytics UI must surface only aggregate Privacy attention");
expect(analyticsPagePath, analyticsPage, /view=privacy/, "Analytics must deep-link Privacy attention into the governed Action Center");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /privacy-dsr-lifecycle:validate/, "Privacy lifecycle validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*privacy-dsr-lifecycle:validate/, "Privacy lifecycle validator must run before production builds");

if (failures.length) {
  console.error("Privacy DSR lifecycle validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Privacy DSR lifecycle validation passed.");
