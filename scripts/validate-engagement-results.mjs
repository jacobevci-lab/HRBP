import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const resultsPath = "lib/engagement-results.ts";
const results = await source(resultsPath);
expect(resultsPath, results, /can\(ctx,\s*"engagement:write"\)/, "engagement results must require governance write authority");
expect(resultsPath, results, /resolveEmploymentScope\(db, ctx\)/, "engagement results must reuse relationship scope");
expect(resultsPath, results, /campaign\.anonymous && scope !== null/, "anonymous results must treat relationship-scoped viewers specially");
expect(resultsPath, results, /canonicalAudience\.some\(\(employmentId\) => !allowed\.has\(employmentId\)\)/, "anonymous results must require full authorized audience coverage");
expect(resultsPath, results, /Math\.max\(5, campaign\.anonymityThreshold\)/, "results must enforce a minimum privacy threshold");
expect(resultsPath, results, /responseCount < threshold/, "low-volume campaign results must be suppressed");
expect(resultsPath, results, /question\.type === SurveyQuestionType\.TEXT/, "free-text questions must have an explicit suppression path");
expect(resultsPath, results, /Free-text responses are never displayed/, "free-text answer content must never be exposed in aggregate results");
expect(resultsPath, results, /lowVolumeBucket/, "choice distributions must detect low-volume non-empty buckets");
expect(resultsPath, results, /Choice distribution is suppressed/, "choice questions with low-volume buckets must be fully suppressed");
expect(resultsPath, results, /RESULT_SET_TOO_LARGE/, "interactive result aggregation must remain bounded");
expect(resultsPath, results, /\["OPEN", "CLOSED", "ARCHIVED"\]\.includes\(campaign\.status\)/, "results must not be available before campaign opening");
reject(resultsPath, results, /respondentTokenHash/, "result aggregation must not load respondent pseudonyms");
reject(resultsPath, results, /personId|givenName|familyName|workEmail|employeeNumber/, "result aggregation must not load employee identity");
expect(resultsPath, results, /aggregatableQuestions = campaign\.survey\.questions\.filter\(\(question\) => question\.type !== SurveyQuestionType\.TEXT\)/, "text question ids must be excluded before loading answer values");
expect(resultsPath, results, /questionId:\s*\{\s*in:\s*questionIds\s*\}/, "answer aggregation must query only explicitly aggregatable question ids");

const routePath = "app/api/engagement/campaigns/[id]/results/route.ts";
const route = await source(routePath);
expect(routePath, route, /can\(ctx,\s*"engagement:write"\)/, "results route must require engagement write authority");
expect(routePath, route, /cache-control": "no-store"/, "actor-specific result output must remain non-cacheable");
expect(routePath, route, /RESULT_SET_TOO_LARGE/, "oversized interactive result sets must fail closed");
expect(routePath, route, /code === "STATE"/, "results route must surface lifecycle state rejection");

const uiPath = "components/engagement-results-panel.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/api\/engagement\/campaigns\/.*\/results/, "results UI must use the governed campaign results route");
expect(uiPath, ui, /Results suppressed/, "results UI must visibly communicate suppression");
expect(uiPath, ui, /Aggregate only/, "results UI must communicate aggregate-only disclosure");
expect(uiPath, ui, /Privacy threshold/, "results UI must surface the active privacy threshold");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /EngagementResultsPanel/, "campaign results must be mounted in the owning Engagement workspace");
expect(workspacePath, workspace, /engagementCanWrite&&\["OPEN","CLOSED","ARCHIVED"\]/, "results UI must remain governance-only and lifecycle-bound");

const continuityPath = "lib/engagement-action-center-continuity.ts";
const continuity = await source(continuityPath);
reject(continuityPath, continuity, /SurveyAnswer|questionKey|distribution|responseRate/, "central Action Center must not receive engagement result detail");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /engagement-results:validate/, "engagement results validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*engagement-results:validate/, "engagement results validation must run before production builds");

if (failures.length) {
  console.error("Engagement results validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Engagement results validation passed.");
