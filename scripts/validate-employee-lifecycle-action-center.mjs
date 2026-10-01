import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const continuityPath = "lib/employee-lifecycle-action-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /can\(ctx,\s*"onboarding:write"\)/, "onboarding shared attention must require write authority");
expect(continuityPath, continuity, /resolveOnboardingPopulationScope/, "onboarding attention must reuse relationship population scope");
expect(continuityPath, continuity, /onboardingPlanPopulationFilter\(scope\)/, "onboarding query must stay inside governed population scope");
expect(continuityPath, continuity, /sensitive:\s*false/, "sensitive onboarding tasks must be excluded from shared attention");
expect(continuityPath, continuity, /status:\s*\{\s*in:\s*OPEN_ONBOARDING_TASKS/, "only open onboarding tasks may enter the shared queue");
expect(continuityPath, continuity, /take:\s*100/, "onboarding plan aggregation must be bounded");
expect(continuityPath, continuity, /href:\s*`\/module\/onboarding\?task=/, "onboarding attention must deep-link to the existing scoped task focus");
expect(continuityPath, continuity, /type:\s*"advance-onboarding-task"[\s\S]*status:\s*"COMPLETED"/, "in-progress onboarding attention must expose bounded completion");
expect(continuityPath, continuity, /type:\s*"advance-onboarding-task"[\s\S]*status:\s*"IN_PROGRESS"/, "not-started or blocked onboarding attention must expose bounded in-progress transition");
expect(continuityPath, continuity, /task\.status === OnboardingTaskStatus\.IN_PROGRESS[\s\S]*advance-onboarding-task/, "onboarding quick action must derive target state from the governed task status");
reject(continuityPath, continuity, /type:\s*"advance-onboarding-task"[^}]*status:\s*"BLOCKED"|type:\s*"advance-onboarding-task"[^}]*status:\s*"WAIVED"/, "shared onboarding quick actions must not create blocker or waiver states that require reasons");

expect(continuityPath, continuity, /can\(ctx,\s*"offboarding:write"\)/, "offboarding shared attention must require write authority");
expect(continuityPath, continuity, /resolveEmploymentScope/, "offboarding attention must reuse employment relationship scope");
expect(continuityPath, continuity, /\.\.\.employmentIdFilter\(scope\)/, "offboarding process query must stay relationship scoped");
expect(continuityPath, continuity, /status:\s*\{\s*in:\s*OPEN_SEPARATIONS/, "only open separation processes may enter attention");
expect(continuityPath, continuity, /finalSettlementStatus:\s*true/, "offboarding attention may use only the settlement state needed for operational routing");
expect(continuityPath, continuity, /tasks:[\s\S]*select:\s*\{\s*id:\s*true,\s*status:\s*true\s*\}/, "offboarding task projection must remain minimized");
reject(continuityPath, continuity, /employeeReason|rehireDecisionReason|replacementDecisionReason|finalSettlementNote|exceptionReason|accountId|serialNumber|conditionNote/, "shared offboarding attention must not load restricted narrative or account/asset detail");
expect(continuityPath, continuity, /slice\(0,\s*300\)/, "combined action queue must remain bounded");
expect(continuityPath, continuity, /employeeLifecycleDegraded/, "new lifecycle aggregation must fail soft without suppressing the existing queue");

const signatureContinuityPath = "lib/document-signature-action-continuity.ts";
const signatureContinuity = await source(signatureContinuityPath);
expect(signatureContinuityPath, signatureContinuity, /getEmployeeLifecycleActionCenterData/, "document-signature continuity must preserve the employee lifecycle queue as its governed base");

const recruitingContinuityPath = "lib/recruiting-action-center-continuity.ts";
const recruitingContinuity = await source(recruitingContinuityPath);
expect(recruitingContinuityPath, recruitingContinuity, /getDocumentSignatureLifecycleActionCenterData\(ctx\)/, "the current top-level Recruiting wrapper must preserve document-signature and employee lifecycle continuity");
expect(recruitingContinuityPath, recruitingContinuity, /employeeLifecycleDegraded:\s*base\.employeeLifecycleDegraded/, "top-level continuity must preserve employee lifecycle degradation state");

const apiPath = "app/api/action-center/route.ts";
const api = await source(apiPath);
expect(apiPath, api, /getWorkflowDefinitionLifecycleActionCenterData/, "Action Center API must serve the latest layered governed queue");

const uiPath = "components/workflow-action-center.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /"onboarding"/, "Action Center UI must understand onboarding attention");
expect(uiPath, ui, /"offboarding"/, "Action Center UI must understand offboarding attention");
expect(uiPath, ui, /summary\.onboarding/, "Action Center must expose onboarding source count");
expect(uiPath, ui, /summary\.offboarding/, "Action Center must expose offboarding source count");
expect(uiPath, ui, /item\.action\.type === "advance-onboarding-task"[\s\S]*\/api\/onboarding\/tasks\//, "onboarding quick actions must reuse the governed task-status endpoint");
expect(uiPath, ui, /resourceType:\s*"OnboardingTask"/, "onboarding quick actions must retire matching notifications best-effort");
expect(uiPath, ui, /payload = \{ status: item\.action\.status \}/, "onboarding quick actions must send only the precomputed bounded target status");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /onboarding:\s*0/, "Dashboard fallback must include onboarding attention");
expect(dashboardPath, dashboard, /offboarding:\s*0/, "Dashboard fallback must include offboarding attention");
reject(dashboardPath, dashboard, /data\.items|items:/, "Dashboard must remain aggregate-only");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /onboarding:\s*source\.summary\.onboarding/, "Analytics may project onboarding count only");
expect(analyticsPath, analytics, /offboarding:\s*source\.summary\.offboarding/, "Analytics may project offboarding count only");
reject(analyticsPath, analytics, /(?:task\.title|employeeReason|finalSettlementNote|accountId|assetTag|subjectId)\s*:/, "Analytics must not project employee lifecycle record detail");

if (failures.length) {
  console.error("Employee lifecycle Action Center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Employee lifecycle Action Center validation passed.");
