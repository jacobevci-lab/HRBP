import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const routePath = "app/api/engagement/campaigns/[id]/responses/route.ts";
const route = await source(routePath);
expect(routePath, route, /can\(ctx,\s*"engagement:read"\)/, "response intake must require authenticated engagement read authority");
expect(routePath, route, /ctx\.employmentId/, "response intake must require trusted employment context");
expect(routePath, route, /status:\s*\{\s*not:\s*EmploymentStatus\.TERMINATED/, "response intake must require an active tenant employment");
expect(routePath, route, /campaign\.status !== SurveyStatus\.OPEN/, "responses must be accepted only for OPEN campaigns");
expect(routePath, route, /campaign\.opensAt[\s\S]*campaign\.closesAt/, "response intake must enforce the campaign response window");
expect(routePath, route, /audienceIds\.length && !audienceIds\.includes\(employment\.id\)/, "response intake must enforce canonical campaign audience membership");
expect(routePath, route, /HRBP_ENGAGEMENT_RESPONSE_SECRET/, "response pseudonyms must use a dedicated stable secret");
expect(routePath, route, /createHmac\("sha256"/, "response pseudonyms must use HMAC-SHA256");
expect(routePath, route, /engagement-response:v1:/, "response HMAC must be domain-separated and versioned");
expect(routePath, route, /employmentId:\s*loaded\.campaign\.anonymous \? null : loaded\.employmentId/, "anonymous responses must not persist employment ids");
expect(routePath, route, /if \(!loaded\.campaign\.anonymous\)[\s\S]*appendAudit/, "actor-linked audit evidence must be limited to confidential responses");
expect(routePath, route, /SurveyQuestionType\.SCALE[\s\S]*value < 1[\s\S]*value > 5/, "scale answers must be bounded to 1-5");
expect(routePath, route, /SurveyQuestionType\.ENPS[\s\S]*value < 0[\s\S]*value > 10/, "eNPS answers must be bounded to 0-10");
expect(routePath, route, /SurveyQuestionType\.SINGLE_CHOICE/, "single-choice answers must be validated");
expect(routePath, route, /SurveyQuestionType\.MULTI_CHOICE/, "multi-choice answers must be validated");
expect(routePath, route, /question\.required && !submitted\.has\(question\.id\)/, "all required questions must be answered");
expect(routePath, route, /P2002/, "duplicate response tokens must return a conflict");
expect(routePath, route, /questions:\s*existing \? \[\]/, "submitted respondents must not receive answer-form questions again");
reject(routePath, route, /promptHash|responseHash/, "engagement response intake must not reuse AI telemetry fields");

const attentionHelperPath = "lib/engagement-response-attention.ts";
const attentionHelper = await source(attentionHelperPath);
expect(attentionHelperPath, attentionHelper, /HRBP_ENGAGEMENT_RESPONSE_SECRET/, "pending response attention must use the same stable HMAC secret");
expect(attentionHelperPath, attentionHelper, /status:\s*SurveyStatus\.OPEN/, "response attention must include only OPEN campaigns");
expect(attentionHelperPath, attentionHelper, /status:\s*\{\s*not:\s*EmploymentStatus\.TERMINATED/, "response attention must require active employment context");
expect(attentionHelperPath, attentionHelper, /canonicalAudienceIds/, "response attention must enforce canonical audience membership");
expect(attentionHelperPath, attentionHelper, /surveyResponse\.findMany/, "response attention must suppress already-submitted campaigns");
expect(attentionHelperPath, attentionHelper, /respondentTokenHash/, "response attention must match pseudonymous submission tokens inside the owning Engagement helper");

const continuityPath = "lib/engagement-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getPendingEngagementResponseCampaigns\(ctx\)/, "Engagement continuity must consume privacy-safe pending-response candidates");
expect(continuityPath, continuity, /\/module\/engagement\?campaign=.*mode=respond/, "pending response attention must deep-link to the exact Engagement campaign");
expect(continuityPath, continuity, /Your response is pending/, "Action Center must identify pending participant response work");
reject(continuityPath, continuity, /audienceFilter|respondentTokenHash|SurveyAnswer|questionKey|prompt:/, "central Engagement continuity must not expose audience, pseudonym or answer content");

const envPath = ".env.example";
const env = await source(envPath);
expect(envPath, env, /HRBP_ENGAGEMENT_RESPONSE_SECRET=replace-with-at-least-32-random-characters/, "engagement response HMAC secret must be documented");

const uiPath = "components/engagement-response-action.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/responses/, "Engagement response UI must use the owning response route");
expect(uiPath, ui, /Answer all required questions/, "client response UX must surface required-question validation");
expect(uiPath, ui, /Submit response/, "Engagement workspace must expose response submission");
expect(uiPath, ui, /context\.anonymous \? "Anonymous" : "Confidential"/, "response UX must clearly communicate anonymity mode");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /EngagementResponseAction/, "OPEN campaigns must mount the response action in the governed Engagement workspace");
expect(workspacePath, workspace, /row\.rawStatus==="OPEN"&&ctx\.employmentId/, "response action must require OPEN campaign and trusted employment context");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
reject(dataPath, data, /surveyAnswer\.findMany|respondentTokenHash|answers:\s*\{/, "general Engagement live data must not project answer content or respondent pseudonyms");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /engagement-response-intake:validate/, "Engagement response validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*engagement-response-intake:validate/, "Engagement response validation must run before production builds");

if (failures.length) {
  console.error("Engagement response intake validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Engagement response intake validation passed.");
