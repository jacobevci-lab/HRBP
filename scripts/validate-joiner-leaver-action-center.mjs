import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const continuityPath = "lib/joiner-leaver-action-center-continuity.ts";
const continuity = await source(continuityPath);

expect(continuityPath, continuity, /can\(ctx,\s*"onboarding:write"\)/, "onboarding attention must require onboarding write authority");
expect(continuityPath, continuity, /resolveOnboardingPopulationScope\(db,\s*ctx\)/, "onboarding attention must reuse governed population scope");
expect(continuityPath, continuity, /onboardingPlanPopulationFilter\(scope\)/, "onboarding plan reads must keep population filtering");
expect(continuityPath, continuity, /orderBy:\s*\{\s*targetStartDate:\s*"asc"\s*\}[\s\S]*take:\s*100/, "onboarding attention must match the owning workspace bound and ordering");
expect(continuityPath, continuity, /HRBP_ONBOARDING_DUE_SOON_HOURS/, "onboarding task attention must reuse the configured due-soon horizon");
expect(continuityPath, continuity, /HRBP_ONBOARDING_START_RISK_HOURS/, "onboarding start-risk attention must reuse the configured readiness horizon");
expect(continuityPath, continuity, /managerUserId\s*\?\?\s*plan\.ownerId/, "manager task accountability must preserve plan-owner fallback");
expect(continuityPath, continuity, /recipientId\s*!==\s*ctx\.actorId/, "onboarding task attention must be actor accountable");
expect(continuityPath, continuity, /task\.sensitive\s*\?\s*"Restricted onboarding task"/, "sensitive onboarding task titles must be minimized in the shared queue");
expect(continuityPath, continuity, /href:\s*`\/module\/onboarding\?task=/, "onboarding task attention must deep-link to the owning workspace");
expect(continuityPath, continuity, /href:\s*`\/module\/onboarding\?plan=/, "onboarding plan attention must deep-link to the owning workspace");
expect(continuityPath, continuity, /status:\s*"ready for activation"/, "completed preboarding plans must surface the explicit activation handoff");

expect(continuityPath, continuity, /can\(ctx,\s*"offboarding:write"\)/, "offboarding attention must require offboarding write authority");
expect(continuityPath, continuity, /resolveEmploymentScope\(db,\s*ctx\)/, "offboarding attention must reuse employment relationship scope");
expect(continuityPath, continuity, /employmentIdFilter\(scope\)/, "offboarding process reads must remain employment scoped");
expect(continuityPath, continuity, /orderBy:\s*\[\{\s*lastWorkingDate:\s*"asc"\s*\},\s*\{\s*createdAt:\s*"desc"\s*\}\][\s\S]*take:\s*150/, "offboarding attention must match the owning workspace bound and ordering");
expect(continuityPath, continuity, /HRBP_OFFBOARDING_DUE_SOON_HOURS/, "offboarding task attention must reuse the configured due-soon horizon");
expect(continuityPath, continuity, /HRBP_OFFBOARDING_EXIT_RISK_HOURS/, "offboarding exit-risk attention must reuse the configured readiness horizon");
expect(continuityPath, continuity, /task\.ownerId\s*\?\s*task\.ownerId\s*===\s*ctx\.actorId\s*:\s*ctx\.role\s*===\s*fallbackRoleForExitDomain/, "offboarding task attention must remain explicit-owner or reminder-role accountable");
expect(continuityPath, continuity, /process\.initiatedById\s*!==\s*ctx\.actorId/, "final separation closure attention must preserve independent closer separation");
expect(continuityPath, continuity, /process\.finalSettlementStatus\s*===\s*"SETTLED"/, "close attention must require settled final settlement state");
expect(continuityPath, continuity, /href:\s*`\/module\/offboarding\?task=/, "offboarding task attention must deep-link to the owning workspace");
expect(continuityPath, continuity, /href:\s*`\/module\/offboarding\?process=/, "offboarding process attention must deep-link to the owning workspace");

expect(continuityPath, continuity, /action:\s*null/g, "joiner/leaver items must stay deep-link only");
reject(continuityPath, continuity, /\.update\(|\.updateMany\(|\.create\(|\.delete\(/, "Action Center continuity must not mutate onboarding/offboarding business records");
reject(continuityPath, continuity, /exitInterview|exit-interview|finalSettlementNote|replacementDecisionReason|conditionNote|exceptionReason|evidenceDocumentId|rehire/, "shared joiner/leaver attention must not load restricted decision/evidence narratives");
expect(continuityPath, continuity, /settle\("Onboarding"/, "onboarding aggregation must fail independently");
expect(continuityPath, continuity, /settle\("Offboarding"/, "offboarding aggregation must fail independently");
expect(continuityPath, continuity, /slice\(0,\s*300\)/, "combined Action Center must remain bounded");
expect(continuityPath, continuity, /onboarding:\s*items\.filter\(\(item\) => item\.module === "onboarding"\)\.length/, "summary must expose aggregate onboarding attention");
expect(continuityPath, continuity, /offboarding:\s*items\.filter\(\(item\) => item\.module === "offboarding"\)\.length/, "summary must expose aggregate offboarding attention");

const apiPath = "app/api/action-center/route.ts";
const api = await source(apiPath);
expect(apiPath, api, /getLifecycleActionCenterFullContinuityData/, "Action Center API must serve full joiner/leaver continuity");

const onboardingConsolePath = "components/onboarding-operations-console.tsx";
const onboardingConsole = await source(onboardingConsolePath);
expect(onboardingConsolePath, onboardingConsole, /search\.get\("task"\)/, "onboarding console must resolve exact task deep links only inside its loaded scope");
expect(onboardingConsolePath, onboardingConsole, /search\.get\("plan"\)/, "onboarding console must resolve exact plan deep links only inside its loaded scope");
reject(onboardingConsolePath, onboardingConsole, /findUnique|\/api\/onboarding\/.*\?id=/, "onboarding focus must not issue a broad primary-key fallback");

const offboardingConsolePath = "components/offboarding-operations-console.tsx";
const offboardingConsole = await source(offboardingConsolePath);
expect(offboardingConsolePath, offboardingConsole, /search\.get\("task"\)/, "offboarding console must resolve exact task deep links only inside its loaded scope");
expect(offboardingConsolePath, offboardingConsole, /search\.get\("process"\)/, "offboarding console must resolve exact process deep links only inside its loaded scope");
reject(offboardingConsolePath, offboardingConsole, /findUnique|\/api\/offboarding\/.*\?id=/, "offboarding focus must not issue a broad primary-key fallback");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /onboarding:\s*0/, "Dashboard fail-closed summary must include onboarding");
expect(dashboardPath, dashboard, /offboarding:\s*0/, "Dashboard fail-closed summary must include offboarding");
reject(dashboardPath, dashboard, /data\.items|items:/, "Dashboard continuity must remain aggregate-only");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /onboarding:\s*source\.summary\.onboarding/, "Analytics must project only the onboarding count");
expect(analyticsPath, analytics, /offboarding:\s*source\.summary\.offboarding/, "Analytics must project only the offboarding count");
reject(analyticsPath, analytics, /employeeName:|taskName:|finalSettlement|exitInterview|subjectId:/, "Analytics continuity must not project joiner/leaver row detail");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /joiner-leaver-action-center:validate/, "joiner/leaver validator must remain in repository scripts");
expect(packagePath, pkg, /prebuild[^\n]*joiner-leaver-action-center:validate/, "joiner/leaver validator must run before production builds");

if (failures.length) {
  console.error("Joiner / leaver Action Center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Joiner / leaver Action Center validation passed.");
