import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const growthPath = "lib/growth-action-center-continuity.ts";
const growth = await source(growthPath);
expect(growthPath, growth, /DevelopmentPlanStatus\.DRAFT[\s\S]*DevelopmentPlanStatus\.ACTIVE/, "development-plan owner attention must include owned drafts for activation and active plans nearing review");
expect(growthPath, growth, /can\(ctx,\s*"talent:write"\)/, "development-plan attention must require talent write authority");
expect(growthPath, growth, /ownerId:\s*ctx\.actorId/, "development-plan attention must be bound to the signed human owner");
expect(growthPath, growth, /HRBP_DEVELOPMENT_PLAN_WARNING_DAYS/, "development-plan attention must reuse the configured reminder horizon");
expect(growthPath, growth, /href:\s*`\/module\/talent\?developmentPlan=/, "development-plan attention must deep-link to the exact governed plan");
expect(growthPath, growth, /plan\.status === DevelopmentPlanStatus\.DRAFT[\s\S]*type:\s*"activate-development-plan"/, "owned development-plan drafts must expose bounded activation");
expect(growthPath, growth, /can\(ctx,\s*"succession:write"\)/, "succession attention must require succession write authority");
expect(growthPath, growth, /ownerId:\s*ctx\.actorId[\s\S]*active:\s*true[\s\S]*reviewDueAt:/, "succession attention must be active, owner-bound and review-date driven");
expect(growthPath, growth, /HRBP_SUCCESSION_REVIEW_WARNING_DAYS/, "succession attention must reuse the configured reminder horizon");
expect(growthPath, growth, /href:\s*`\/module\/succession\?plan=/, "succession attention must deep-link to the exact governed plan");
expect(growthPath, growth, /developmentPlans:\s*items\.filter\(\(item\) => item\.kind === "development-plan"\)\.length/, "summary must expose aggregate development-plan attention");
expect(growthPath, growth, /succession:\s*items\.filter\(\(item\) => item\.kind === "succession"\)\.length/, "summary must expose aggregate succession attention");
expect(growthPath, growth, /slice\(0,\s*300\)/, "shared queue must remain bounded after owner attention is added");
reject(growthPath, growth, /outcomeNotes|developmentGap|performance:\s*true|potential:\s*true|readiness:\s*true|score|certificateReference/, "owner attention must not load human assessment detail or learning evidence");
expect(growthPath, growth, /LearningAssignmentStatus\.ASSIGNED[\s\S]*LearningAssignmentStatus\.OVERDUE[\s\S]*start-learning-assignment/, "only assigned or overdue self learning may expose bounded quick-start progression");
reject(growthPath, growth, /start-learning-assignment[\s\S]*COMPLETED/, "Action Center must not complete learning assignments without domain evidence");

const pagePath = "app/module/[slug]/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /search\.developmentPlan/, "module routing must accept exact development-plan focus");
expect(pagePath, page, /search\.plan/, "module routing must accept exact succession-plan focus");
expect(pagePath, page, /slug === "talent"[\s\S]*developmentPlanFocus/, "talent focus must remain domain-specific");
expect(pagePath, page, /slug === "succession"[\s\S]*successionPlanFocus/, "succession focus must remain domain-specific");

const growthModulePath = "components/growth-module-page.tsx";
const growthModule = await source(growthModulePath);
expect(growthModulePath, growthModule, /getSuccessionGovernanceData\(ctx,\s*\{[\s\S]*focusId[\s\S]*\}\)/, "succession exact focus must flow into governed succession data");
expect(growthModulePath, growthModule, /getDevelopmentPlanGovernanceData\(ctx,\s*\{[\s\S]*focusId[\s\S]*\}\)/, "development-plan exact focus must flow into governed talent data");
expect(growthModulePath, growthModule, /focusId\s*&&\s*!data\.focusVisible/, "succession must warn when exact owner focus is unavailable");
expect(growthModulePath, growthModule, /focusId\s*&&\s*!development\.focusVisible/, "development-plan must warn when exact owner focus is unavailable");
expect(growthModulePath, growthModule, /No broader plan lookup was attempted/, "invalid growth focus must fail closed without broad fallback");

const developmentDataPath = "lib/development-plan-data.ts";
const developmentData = await source(developmentDataPath);
expect(developmentDataPath, developmentData, /focusId\?\.trim\(\)\.slice\(0,\s*128\)/, "development-plan focus input must be bounded");
expect(developmentDataPath, developmentData, /employmentIdFilter\(scope\)/, "development-plan focus must stay inside relationship scope");
expect(developmentDataPath, developmentData, /plan\.id\s*===\s*focusId\s*&&\s*plan\.ownerId\s*===\s*ctx\.actorId/, "development-plan focus must also require signed owner identity");
expect(developmentDataPath, developmentData, /orderedPlans[\s\S]*left\.id\s*===\s*focusId/, "authorized development-plan focus must be pinned without a second broad query");
reject(developmentDataPath, developmentData, /findUnique\(|findFirst\(\{[\s\S]*id:\s*focusId/, "development-plan focus must not fall back to an unscoped primary-key lookup");

const successionDataPath = "lib/succession-governance-data.ts";
const successionData = await source(successionDataPath);
expect(successionDataPath, successionData, /focusId\?\.trim\(\)\.slice\(0,\s*128\)/, "succession focus input must be bounded");
expect(successionDataPath, successionData, /employmentPrimaryKeyFilter\(scope\)/, "succession focus must preserve relationship-scoped position authorization");
expect(successionDataPath, successionData, /plan\.id\s*===\s*focusId\s*&&\s*plan\.ownerId\s*===\s*ctx\.actorId/, "succession focus must require signed owner identity");
expect(successionDataPath, successionData, /orderedPlans[\s\S]*left\.id\s*===\s*focusId/, "authorized succession focus must be pinned without a second broad query");
reject(successionDataPath, successionData, /findUnique\(|findFirst\(\{[\s\S]*id:\s*focusId/, "succession focus must not fall back to an unscoped primary-key lookup");

const componentPath = "components/workflow-action-center.tsx";
const component = await source(componentPath);
expect(componentPath, component, /"development-plan"/, "Action Center UI must understand development-plan attention");
expect(componentPath, component, /"succession"/, "Action Center UI must understand succession attention");
expect(componentPath, component, /summary\.developmentPlans/, "Action Center UI must expose development-plan count");
expect(componentPath, component, /summary\.succession/, "Action Center UI must expose succession count");
expect(componentPath, component, /item\.action\.type === "start-learning-assignment"[\s\S]*\/api\/learning\/assignments\//, "participant learning quick-start must use the governed self-transition endpoint");
expect(componentPath, component, /payload = \{ status: "IN_PROGRESS" \}/, "learning quick-start must only move assignments into in-progress state");
expect(componentPath, component, /resourceType:\s*"LearningAssignment"/, "learning quick-start must clear matching notifications best-effort");
expect(componentPath, component, /item\.action\.type === "activate-development-plan"[\s\S]*\/api\/talent\/development-plans\//, "development-plan activation must use the governed plan endpoint");
expect(componentPath, component, /method = item\.action\.type === "activate-development-plan" \? "PATCH" : "POST"/, "development-plan activation must preserve the owning PATCH mutation contract");
expect(componentPath, component, /resourceType:\s*"DevelopmentPlan"/, "development-plan activation must clear matching notifications best-effort");
expect(growthPath, growth, /ReviewStatus\.NOT_STARTED[\s\S]*start-performance-self-review/, "only not-started self reviews may expose bounded quick-start progression");
expect(componentPath, component, /item\.action\.type === "start-performance-self-review"[\s\S]*\/api\/performance\/reviews\//, "performance self-review quick-start must use the governed self-start endpoint");
expect(componentPath, component, /resourceType:\s*"PerformanceReview"/, "performance self-review quick-start must clear matching notifications best-effort");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /developmentPlans:\s*0/, "Dashboard safe fallback must include development-plan attention");
expect(dashboardPath, dashboard, /succession:\s*0/, "Dashboard safe fallback must include succession attention");
reject(dashboardPath, dashboard, /data\.items|items:/, "Dashboard must remain aggregate-only");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /developmentPlans:\s*source\.summary\.developmentPlans/, "Analytics must project only the development-plan count");
expect(analyticsPath, analytics, /succession:\s*source\.summary\.succession/, "Analytics must project only the succession count");
reject(analyticsPath, analytics, /(?:outcomeNotes|developmentGap|readiness|targetProficiency|currentProficiency)\s*:/, "Analytics continuity must not project growth decision evidence fields");

if (failures.length) {
  console.error("Growth owner attention validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Growth owner attention validation passed.");
