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
expect(dataPath, data, /action:\s*\{\s*type:\s*"approve-leave"[\s\S]*secondaryAction:\s*\{\s*type:\s*"reject-leave"/, "leave decisions must expose bounded approve and reject actions");
expect(dataPath, data, /action:\s*\{\s*type:\s*"approve-time"[\s\S]*secondaryAction:\s*\{\s*type:\s*"reject-time"/, "time decisions must expose bounded approve and reject actions");
expect(dataPath, data, /type:\s*"approve-compensation"[\s\S]*type:\s*"apply-compensation"[\s\S]*type:\s*"reject-compensation"/, "compensation approval must expose independent approve/reject decisions while applied state keeps its state-specific action");
expect(dataPath, data, /type:\s*"approve-payroll"[\s\S]*type:\s*"mark-payroll-paid"/, "payroll approval and payment must expose separated state-specific quick actions");
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
expect(componentPath, component, /item\.action\.type === "complete-workflow"[\s\S]*\/api\/workflows\/instances\//, "workflow completion must keep using the governed workflow endpoint");
expect(componentPath, component, /item\.action\.type === "approve-leave"[\s\S]*\/api\/leave\/requests\//, "leave quick approval must use the governed leave decision endpoint");
expect(componentPath, component, /item\.secondaryAction\.type === "reject-leave"[\s\S]*decision:\s*"REJECTED"/, "leave quick rejection must use the governed leave decision endpoint");
expect(componentPath, component, /item\.action\.type === "approve-time"[\s\S]*\/api\/time\/entries\//, "time quick approval must use the governed time transition endpoint");
expect(componentPath, component, /item\.secondaryAction\.type === "reject-time"[\s\S]*status:\s*"REJECTED"/, "time quick rejection must use the governed time transition endpoint");
expect(componentPath, component, /item\.action\.type === "approve-compensation"[\s\S]*decision:\s*"APPROVE"/, "compensation quick approval must preserve the independent decision API");
expect(componentPath, component, /item\.secondaryAction\.type === "reject-compensation"[\s\S]*decision:\s*"REJECT"/, "compensation rejection must preserve the independent decision API");
expect(componentPath, component, /item\.action\.type === "apply-compensation"[\s\S]*decision:\s*"APPLY"/, "compensation apply must use the governed application path");
expect(componentPath, component, /item\.action\.type === "approve-payroll"[\s\S]*status:\s*"APPROVED"/, "payroll approval must preserve the separated approval transition");
expect(componentPath, component, /status:\s*"PAID"/, "payroll payment completion must use the governed paid transition");
expect(componentPath, component, /window\.confirm\(copy\.confirm\)/, "state-changing Action Center quick actions must require explicit confirmation");
expect(componentPath, component, /workflow-row-actions[\s\S]*executeSecondaryAction/, "paired decisions must render both governed primary and rejection controls");
expect(componentPath, component, /if \(!response\.ok\) throw[\s\S]*await refresh\(\)/, "quick actions must refresh only after a successful governed mutation");
expect(componentPath, component, /<Link[\s\S]*href=\{item\.href\}/, "actions without a safe quick mutation must continue to deep-link into their owning governed module");
expect(componentPath, component, /Search action center|Aksiyon merkezinde ara/, "Action Center must expose bounded local search");
expect(componentPath, component, /event\.target\.value\.slice\(0, 160\)/, "Action Center search input must remain bounded");
expect(componentPath, component, /Quick actions only|Yalnız hızlı işlem/, "Action Center must support actionable-only filtering");
expect(componentPath, component, /Boolean\(item\.action \|\| item\.secondaryAction\)/, "actionable-only filtering must derive solely from governed quick-action metadata");
expect(componentPath, component, /item\.subjectType[\s\S]*item\.subjectId[\s\S]*sourceLabel\(item\.kind\)/, "Action Center local search must cover bounded operational metadata already present in the queue");
reject(componentPath, component, /fetch\("\/api\/action-center\?/, "Action Center search must remain client-side and must not broaden server-side scope");

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
