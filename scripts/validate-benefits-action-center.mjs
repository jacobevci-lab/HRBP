import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const growthPath = "lib/growth-action-center-continuity.ts";
const growth = await source(growthPath);
expect(growthPath, growth, /can\(ctx,\s*"benefits:write"\)/, "benefits attention must require benefits:write");
expect(growthPath, growth, /resolveEmploymentScope\(db,\s*ctx\)/, "benefits attention must resolve the signed actor's employment relationship scope");
expect(growthPath, growth, /status:\s*BenefitEnrollmentStatus\.PENDING/, "only pending benefit elections may enter the shared action queue");
expect(growthPath, growth, /\.\.\.employmentIdFilter\(scope\)/, "benefits attention must enforce the existing employment scope");
expect(growthPath, growth, /take:\s*100/, "benefits attention must remain bounded");
expect(growthPath, growth, /href:\s*`\/module\/benefits\?enrollment=/, "benefits attention must deep-link to the exact governed enrollment");
expect(growthPath, growth, /dueAt:\s*enrollment\.effectiveFrom\.toISOString\(\)/, "pending election effective date must drive operational urgency");
expect(growthPath, growth, /benefits:\s*items\.filter\(\(item\) => item\.kind === "benefits"\)\.length/, "summary must expose aggregate benefits attention");
reject(growthPath, growth, /employerContribution|employeeContribution|coverageTier/, "shared Action Center aggregation must not load benefit contribution or coverage detail");

const dataPath = "lib/growth-lifecycle-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /getBenefitEnrollmentOperationsData\(ctx: RequestContext, focusId\?: string\)/, "benefits lifecycle data must accept exact focus");
expect(dataPath, data, /focusId\?\.trim\(\)\.slice\(0,\s*160\)/, "benefits focus input must be bounded");
expect(dataPath, data, /visibleWhere[\s\S]*employmentIdFilter\(scope\)/, "focused benefits lookup must reuse the same relationship scope");
expect(dataPath, data, /where:\s*\{\s*\.\.\.visibleWhere,\s*id:\s*boundedFocusId\s*\}/, "exact focus must recheck visibility instead of using an unscoped primary-key lookup");
expect(dataPath, data, /focused:\s*row\.id === boundedFocusId/, "authorized focused enrollment must be marked for the UI");
reject(dataPath, data, /findUnique\(\{\s*where:\s*\{\s*id:\s*boundedFocusId/, "focused benefits lookup must not fall back to an unscoped unique lookup");

const pagePath = "app/module/[slug]/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /search\.enrollment/, "module routing must parse exact benefit enrollment focus");
expect(pagePath, page, /slug === "benefits"[\s\S]*enrollmentFocus/, "benefit focus must remain domain-specific");

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /getBenefitEnrollmentOperationsData\(ctx,\s*focusId\)/, "benefits workspace must load exact focus through the scoped lifecycle source");
expect(modulePath, modulePage, /enrollments\.some\(\(enrollment\) => enrollment\.focused\)/, "benefits workspace must verify focus visibility");
expect(modulePath, modulePage, /No broader record lookup was attempted|Daha geniş bir kayıt sorgusu denenmedi/, "unavailable benefit focus must fail closed without a broad fallback");

const consolePath = "components/growth-lifecycle-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /row\.focused\s*\?\s*" focused"/, "focused benefit election must be visually pinned/highlighted");
expect(consolePath, consoleSource, /hrbp:lifecycle-actions-changed/, "successful benefit lifecycle mutations must refresh the shared Action Center");
expect(consolePath, consoleSource, /\/api\/benefits\/enrollments\/\$\{row\.id\}\/transition/, "benefit decisions must remain in the owning governed endpoint");

const transitionPath = "app/api/benefits/enrollments/[id]/transition/route.ts";
const transition = await source(transitionPath);
expect(transitionPath, transition, /can\(ctx,\s*"benefits:write"\)/, "benefit lifecycle decisions must remain benefits-write gated");
expect(transitionPath, transition, /canActOnEmployment/, "benefit lifecycle decisions must remain relationship scoped");
expect(transitionPath, transition, /appendAudit/, "benefit lifecycle decisions must retain audit evidence");

const actionPath = "components/workflow-action-center.tsx";
const action = await source(actionPath);
expect(actionPath, action, /"benefits"/, "Action Center must understand benefits as its own source");
expect(actionPath, action, /summary\.benefits/, "Action Center must expose the benefits counter");
expect(actionPath, action, /item\.action\?\.type === "complete-workflow"/, "benefits entries must remain deep-link only, not direct decision actions");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /benefits:\s*0/, "Dashboard safe fallback must include benefits attention");
reject(dashboardPath, dashboard, /coverageTier|employerContribution|employeeContribution/, "Dashboard attention must remain aggregate-only for benefits");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /benefits:\s*source\.summary\.benefits/, "Analytics must project only the governed benefits count");
reject(analyticsPath, analytics, /coverageTier\s*:|employerContribution\s*:|employeeContribution\s*:/, "Analytics must not project benefit election detail");

if (failures.length) {
  console.error("Benefits action center continuity validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Benefits action center continuity validation passed.");
