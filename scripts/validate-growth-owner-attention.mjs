import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const growthPath = "lib/growth-action-center-continuity.ts";
const growth = await source(growthPath);
expect(growthPath, growth, /DevelopmentPlanStatus\.ACTIVE/, "development-plan owner attention must only include active plans");
expect(growthPath, growth, /can\(ctx,\s*"talent:write"\)/, "development-plan attention must require talent write authority");
expect(growthPath, growth, /ownerId:\s*ctx\.actorId/, "development-plan attention must be bound to the signed human owner");
expect(growthPath, growth, /HRBP_DEVELOPMENT_PLAN_WARNING_DAYS/, "development-plan attention must reuse the configured reminder horizon");
expect(growthPath, growth, /href:\s*`\/module\/talent\?developmentPlan=/, "development-plan attention must deep-link to the exact governed plan");
expect(growthPath, growth, /can\(ctx,\s*"succession:write"\)/, "succession attention must require succession write authority");
expect(growthPath, growth, /ownerId:\s*ctx\.actorId[\s\S]*active:\s*true[\s\S]*reviewDueAt:/, "succession attention must be active, owner-bound and review-date driven");
expect(growthPath, growth, /HRBP_SUCCESSION_REVIEW_WARNING_DAYS/, "succession attention must reuse the configured reminder horizon");
expect(growthPath, growth, /href:\s*`\/module\/succession\?plan=/, "succession attention must deep-link to the exact governed plan");
expect(growthPath, growth, /developmentPlans:\s*items\.filter\(\(item\) => item\.kind === "development-plan"\)\.length/, "summary must expose aggregate development-plan attention");
expect(growthPath, growth, /succession:\s*items\.filter\(\(item\) => item\.kind === "succession"\)\.length/, "summary must expose aggregate succession attention");
expect(growthPath, growth, /slice\(0,\s*300\)/, "shared queue must remain bounded after owner attention is added");
reject(growthPath, growth, /outcomeNotes|developmentGap|performance:\s*true|potential:\s*true|readiness:\s*true|score|certificateReference/, "owner attention must not load human assessment detail or learning evidence");

const pagePath = "app/module/[slug]/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /search\.developmentPlan/, "module routing must accept exact development-plan focus");
expect(pagePath, page, /search\.plan/, "module routing must accept exact succession-plan focus");
expect(pagePath, page, /slug === "talent"[\s\S]*developmentPlanFocus/, "talent focus must remain domain-specific");
expect(pagePath, page, /slug === "succession"[\s\S]*successionPlanFocus/, "succession focus must remain domain-specific");

const componentPath = "components/workflow-action-center.tsx";
const component = await source(componentPath);
expect(componentPath, component, /"development-plan"/, "Action Center UI must understand development-plan attention");
expect(componentPath, component, /"succession"/, "Action Center UI must understand succession attention");
expect(componentPath, component, /summary\.developmentPlans/, "Action Center UI must expose development-plan count");
expect(componentPath, component, /summary\.succession/, "Action Center UI must expose succession count");
expect(componentPath, component, /item\.action\?\.type\s*===\s*"complete-workflow"/, "new growth attention must remain deep-link only and never become an automatic decision action");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /developmentPlans:\s*0/, "Dashboard safe fallback must include development-plan attention");
expect(dashboardPath, dashboard, /succession:\s*0/, "Dashboard safe fallback must include succession attention");
reject(dashboardPath, dashboard, /data\.items|items:/, "Dashboard must remain aggregate-only");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /developmentPlans:\s*source\.summary\.developmentPlans/, "Analytics must project only the development-plan count");
expect(analyticsPath, analytics, /succession:\s*source\.summary\.succession/, "Analytics must project only the succession count");
reject(analyticsPath, analytics, /outcomeNotes|developmentGap|readiness|targetProficiency|currentProficiency/, "Analytics continuity must not project growth decision evidence");

if (failures.length) {
  console.error("Growth owner attention validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Growth owner attention validation passed.");
