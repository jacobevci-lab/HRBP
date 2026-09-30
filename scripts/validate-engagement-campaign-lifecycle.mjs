import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const routePath = "app/api/engagement/campaigns/[id]/lifecycle/route.ts";
const route = await source(routePath);
expect(routePath, route, /engagement:write/, "campaign lifecycle transitions must require engagement write authority");
expect(routePath, route, /current\.createdById !== ctx\.actorId/, "campaign lifecycle must remain creator-bound");
expect(routePath, route, /SurveyStatus\.DRAFT/, "campaign lifecycle must preserve draft state");
expect(routePath, route, /SurveyStatus\.SCHEDULED/, "campaign lifecycle must preserve scheduled state");
expect(routePath, route, /SurveyStatus\.OPEN/, "campaign lifecycle must preserve open state");
expect(routePath, route, /SurveyStatus\.CLOSED/, "campaign lifecycle must preserve closed state");
expect(routePath, route, /SurveyStatus\.ARCHIVED/, "campaign lifecycle must preserve archived state");
expect(routePath, route, /opensAt[\s\S]*closesAt/, "scheduling must validate the campaign window");
expect(routePath, route, /DataClassification\.CONFIDENTIAL/, "campaign lifecycle audit evidence must remain confidential");

const windowRoutePath = "app/api/engagement/campaigns/[id]/window/route.ts";
const windowRoute = await source(windowRoutePath);
expect(windowRoutePath, windowRoute, /SurveyStatus\.DRAFT/, "only draft campaigns may change their scheduling window");
expect(windowRoutePath, windowRoute, /current\.createdById !== ctx\.actorId/, "campaign window editing must remain creator-bound");
expect(windowRoutePath, windowRoute, /opensAt <= new Date\(\)[\s\S]*closesAt <= opensAt/, "campaign window editing must enforce future ordered dates");

const continuityPath = "lib/engagement-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getPrivacyLifecycleActionCenterData\(ctx\)/, "Engagement must extend the current Privacy continuity chain");
expect(continuityPath, continuity, /createdById:\s*ctx\.actorId/, "Engagement attention must be creator-bound");
expect(continuityPath, continuity, /SurveyStatus\.SCHEDULED[\s\S]*SurveyStatus\.OPEN/, "only scheduled or open campaigns may enter timing attention");
expect(continuityPath, continuity, /\/module\/engagement\?campaign=/, "campaign attention must deep-link to exact governed engagement focus");
expect(continuityPath, continuity, /engagement:\s*items\.filter/, "summary must expose aggregate Engagement attention");
reject(continuityPath, continuity, /audienceFilter|SurveyResponse|responseCount|employmentId/, "central Engagement attention must not load audience or response detail");

const uiPath = "components/workflow-action-center.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /"engagement"/, "Action Center must expose Engagement as a source");
expect(uiPath, ui, /summary\.engagement/, "Action Center must surface aggregate Engagement attention");

const livePath = "components/governance-planning-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /data-engagement-campaign-id/, "Engagement workspace must anchor exact campaign focus");
expect(livePath, live, /campaignFocusVisible/, "invalid campaign focus must fail closed");
expect(livePath, live, /EngagementCampaignActions/, "campaign lifecycle actions must stay in the owning Engagement workspace");
expect(livePath, live, /EngagementCampaignWindowEditor/, "draft campaign scheduling must be configurable in the owning workspace");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.campaign/, "Engagement deep links must accept an exact campaign focus id");
expect(modulePath, modulePage, /slug === "engagement" \? campaignFocus/, "campaign focus must route only into Engagement");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getEngagementLifecycleActionCenterData/, "Dashboard must use the current top-level Engagement continuity source");
expect(dashboardPath, dashboard, /engagement:\s*number/, "Dashboard must carry aggregate Engagement attention only");
reject(dashboardPath, dashboard, /audienceFilter|responses|\.items/, "Dashboard must not receive campaign detail");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /getEngagementLifecycleActionCenterData/, "Analytics must use the current top-level Engagement continuity source");
expect(analyticsPath, analytics, /engagement:\s*source\.summary\.engagement/, "Analytics must project only the Engagement aggregate");
expect(analyticsPath, analytics, /aggregateOnly:\s*true/, "Analytics lifecycle continuity must remain aggregate-only");

const analyticsPagePath = "components/analytics-module-page.tsx";
const analyticsPage = await source(analyticsPagePath);
expect(analyticsPagePath, analyticsPage, /continuity\.summary\.engagement/, "Analytics UI must surface only aggregate Engagement attention");
expect(analyticsPagePath, analyticsPage, /view=engagement/, "Analytics must deep-link Engagement attention into the governed Action Center");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /engagement-campaign-lifecycle:validate/, "Engagement lifecycle validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*engagement-campaign-lifecycle:validate/, "Engagement lifecycle validator must run before production builds");

if (failures.length) {
  console.error("Engagement campaign lifecycle validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Engagement campaign lifecycle validation passed.");
