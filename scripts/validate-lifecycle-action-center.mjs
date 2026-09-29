import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const dataPath = "lib/lifecycle-action-center.ts";
const data = await source(dataPath);
expect(dataPath, data, /tenantId:\s*ctx\.tenantId/, "core lifecycle sources must remain tenant scoped");
expect(dataPath, data, /hrServiceRequestWhere\(db,\s*ctx\)/, "HR Service signals must reuse governed visibility");
expect(dataPath, data, /ownerUserId:\s*ctx\.actorId[\s\S]*assignments:\s*\{\s*some:/, "Employee Relations must preserve Case Wall ownership or assignment scope");
expect(dataPath, data, /documentVisibilityWhere\(db,\s*ctx\)/, "document attention must reuse governed document visibility");
expect(dataPath, data, /can\(ctx,\s*"leave:approve"\)/, "leave attention must require approval authority");
expect(dataPath, data, /can\(ctx,\s*"time:approve"\)/, "time attention must require approval authority");
expect(dataPath, data, /requestedById:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "compensation attention must preserve requester four-eyes separation");
expect(dataPath, data, /creators\.get\(row\.id\) !== ctx\.actorId/, "payroll approval attention must exclude the run creator");
expect(dataPath, data, /row\.approvedById !== ctx\.actorId/, "payroll payment attention must exclude the approver");
reject(dataPath, data, /objectKey|contentHash|scanMessage|currentAnnualBase|proposedAnnualBase|grossPay|netPay|employerCost/, "core aggregation must not load restricted storage, compensation amounts or payroll results");

const growthPath = "lib/growth-action-center-continuity.ts";
const growth = await source(growthPath);
expect(growthPath, growth, /getLifecycleActionCenterData\(ctx\)/, "growth continuity must extend rather than replace the governed core Action Center");
expect(growthPath, growth, /can\(ctx,\s*"performance:self-submit"\)/, "self-review attention must require participant submit authority");
expect(growthPath, growth, /can\(ctx,\s*"performance:manager-review"\)/, "manager-review attention must require assigned-manager authority");
expect(growthPath, growth, /employmentId:\s*ctx\.employmentId[\s\S]*ReviewStatus\.NOT_STARTED[\s\S]*ReviewStatus\.SELF_REVIEW/, "self-review attention must bind to the signed employment identity and actionable states");
expect(growthPath, growth, /managerEmploymentId:\s*ctx\.employmentId[\s\S]*ReviewStatus\.MANAGER_REVIEW/, "manager-review attention must bind to the signed manager employment identity");
expect(growthPath, growth, /cycle:\s*\{\s*status:\s*ReviewCycleStatus\.OPEN\s*\}/, "performance participant attention must require an open review cycle");
expect(growthPath, growth, /href:\s*`\/module\/performance\?review=/, "performance actions must deep-link to an exact governed participant review");
expect(growthPath, growth, /can\(ctx,\s*"learning:self-progress"\)/, "learning attention must require self-progress authority");
expect(growthPath, growth, /LearningAssignmentStatus\.ASSIGNED[\s\S]*LearningAssignmentStatus\.IN_PROGRESS[\s\S]*LearningAssignmentStatus\.OVERDUE/, "only participant-actionable learning states may enter the queue");
expect(growthPath, growth, /employmentId:\s*ctx\.employmentId/, "learning attention must bind to the signed employment identity");
expect(growthPath, growth, /href:\s*`\/module\/learning\?assignment=/, "learning actions must deep-link to the exact governed assignment");
expect(growthPath, growth, /performance:\s*items\.filter\(\(item\) => item\.kind === "performance"\)\.length/, "summary must expose aggregate performance attention");
expect(growthPath, growth, /learning:\s*items\.filter\(\(item\) => item\.kind === "learning"\)\.length/, "summary must expose aggregate learning attention");
expect(growthPath, growth, /catch \(error\)[\s\S]*preserving the governed core Action Center/, "growth-source failure must fail soft without widening scope or suppressing core actions");
expect(growthPath, growth, /slice\(0,\s*300\)/, "expanded Action Center must remain bounded");
reject(growthPath, growth, /managerRating|finalRating|calibrationNotes|score|certificateReference/, "Action Center aggregation must not load participant ratings, calibration notes or learning evidence");

const routePath = "app/api/action-center/route.ts";
const route = await source(routePath);
expect(routePath, route, /getRequestContext\(request\)/, "Action Center API must require authenticated request context");
expect(routePath, route, /getLifecycleActionCenterContinuityData\(ctx\)/, "Action Center API must use the continuity wrapper containing governed growth actions");
expect(routePath, route, /cache-control[\s\S]*no-store/, "personal action queues must never be shared-cached");

const componentPath = "components/workflow-action-center.tsx";
const component = await source(componentPath);
expect(componentPath, component, /fetch\("\/api\/action-center"/, "workspace must consume the lifecycle aggregate API");
for (const kind of ["workflow", "hr-service", "employee-relations", "documents", "leave", "time-attendance", "compensation", "payroll", "performance", "learning"]) {
  expect(componentPath, component, new RegExp(`"${kind}"`), `UI must understand ${kind} lifecycle attention`);
}
expect(componentPath, component, /summary\.performance/, "Action Center must expose performance attention count");
expect(componentPath, component, /summary\.learning/, "Action Center must expose learning attention count");
expect(componentPath, component, /hrbp:lifecycle-actions-changed/, "Action Center must refresh when an owning domain commits a lifecycle mutation");
expect(componentPath, component, /item\.action\?\.type\s*===\s*"complete-workflow"/, "direct completion must remain restricted to workflow tasks");
expect(componentPath, component, /<Link[\s\S]*href=\{item\.href\}/, "non-workflow actions must deep-link into their owning governed module");

const modulePagePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePagePath);
expect(modulePagePath, modulePage, /search\.review/, "module routing must accept exact performance-review focus");
expect(modulePagePath, modulePage, /search\.assignment/, "module routing must accept exact learning-assignment focus");
expect(modulePagePath, modulePage, /GrowthModulePage slug=\{slug as GrowthSlug\} focusId=\{growthFocus\}/, "growth modules must receive only their domain-specific focus identifier");

const performanceDataPath = "lib/performance-participant-data.ts";
const performanceData = await source(performanceDataPath);
expect(performanceDataPath, performanceData, /focusId\?\.trim\(\)\.slice\(0,\s*160\)/, "performance exact focus must be bounded");
expect(performanceDataPath, performanceData, /performanceReview\.findFirst\([\s\S]*id:\s*boundedFocusId[\s\S]*tenantId:\s*ctx\.tenantId/, "performance exact focus must remain tenant scoped");
expect(performanceDataPath, performanceData, /employmentId:\s*ctx\.employmentId[\s\S]*managerEmploymentId:\s*ctx\.employmentId/, "performance exact focus must be limited to self or assigned-manager identity");
expect(performanceDataPath, performanceData, /focusVisible:\s*Boolean\(focusedReview\)/, "inaccessible performance deep links must fail closed");
reject(performanceDataPath, performanceData, /findUnique\([\s\S]*boundedFocusId/, "performance exact focus must not use an unscoped primary-key fallback");

const learningDataPath = "lib/learning-participant-data.ts";
const learningData = await source(learningDataPath);
expect(learningDataPath, learningData, /focusId\?\.trim\(\)\.slice\(0,\s*160\)/, "learning exact focus must be bounded");
expect(learningDataPath, learningData, /learningAssignment\.findFirst\([\s\S]*id:\s*boundedFocusId[\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*employmentId:\s*ctx\.employmentId/, "learning exact focus must remain tenant and employment scoped");
expect(learningDataPath, learningData, /focused:\s*row\.id === boundedFocusId/, "learning focus must be explicitly marked for governed UI targeting");
reject(learningDataPath, learningData, /findUnique\([\s\S]*boundedFocusId/, "learning exact focus must not use an unscoped primary-key fallback");

const growthPagePath = "components/growth-module-page.tsx";
const growthPage = await source(growthPagePath);
expect(growthPagePath, growthPage, /getPerformanceParticipantData\(ctx,\s*focusId\)/, "performance module must resolve exact participant focus through its governed loader");
expect(growthPagePath, growthPage, /getLearningParticipantData\(ctx,\s*focusId\)/, "learning module must resolve exact participant focus through its governed loader");
expect(growthPagePath, growthPage, /No broader record lookup was attempted|Daha geniş bir kayıt sorgusu denenmedi/, "inaccessible performance focus must disclose safe failure without broad fallback");
expect(growthPagePath, growthPage, /No unscoped fallback was used|Kapsamsız bir yedek sorgu kullanılmadı/, "inaccessible learning focus must disclose safe failure without broad fallback");

const performanceConsolePath = "components/performance-participant-console.tsx";
const performanceConsole = await source(performanceConsolePath);
expect(performanceConsolePath, performanceConsole, /resourceType:\s*"PerformanceReview"/, "successful participant review decisions must clear matching notifications best-effort");
expect(performanceConsolePath, performanceConsole, /if \(!response\.ok\) throw[\s\S]*acknowledgePerformanceNotification/, "performance notification acknowledgement must occur only after successful mutation");
expect(performanceConsolePath, performanceConsole, /hrbp:lifecycle-actions-changed/, "performance decisions must invalidate the shared lifecycle queue");
expect(performanceConsolePath, performanceConsole, /review\.focused/, "exact performance focus must be visibly targetable");

const learningConsolePath = "components/learning-participant-console.tsx";
const learningConsole = await source(learningConsolePath);
expect(learningConsolePath, learningConsole, /resourceType:\s*"LearningAssignment"/, "successful learning progress must clear matching notifications best-effort");
expect(learningConsolePath, learningConsole, /if \(!response\.ok\) throw[\s\S]*acknowledgeLearningNotification/, "learning notification acknowledgement must occur only after successful mutation");
expect(learningConsolePath, learningConsole, /hrbp:lifecycle-actions-changed/, "learning progress must invalidate the shared lifecycle queue");
expect(learningConsolePath, learningConsole, /assignment\.focused/, "exact learning focus must be visibly targetable");

const dashboardHelperPath = "lib/dashboard-lifecycle-attention.ts";
const dashboardHelper = await source(dashboardHelperPath);
expect(dashboardHelperPath, dashboardHelper, /getLifecycleActionCenterContinuityData\(ctx\)/, "Dashboard must reuse the same governed continuity source");
expect(dashboardHelperPath, dashboardHelper, /performance:\s*0[\s\S]*learning:\s*0/, "Dashboard safe fallback must include growth counters");
reject(dashboardHelperPath, dashboardHelper, /data\.items|items:/, "Dashboard helper must never expose participant action rows");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /lifecycle-action-center:validate/, "lifecycle Action Center validation must remain wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*lifecycle-action-center:validate/, "lifecycle Action Center validation must run before production builds");

if (failures.length) {
  console.error("Lifecycle action center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Lifecycle action center validation passed.");
