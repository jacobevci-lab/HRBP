import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const surveyPath = "app/api/engagement/surveys/route.ts";
const survey = await source(surveyPath);
expect(surveyPath, survey, /mutationOriginAllowed\(request\)/, "survey creation must enforce origin checks");
expect(surveyPath, survey, /can\(ctx,\s*"engagement:write"\)/, "survey creation must require engagement write authority");
expect(surveyPath, survey, /code may contain letters, numbers, underscore and dash only/, "survey codes must be bounded and normalized");
expect(surveyPath, survey, /P2002/, "duplicate survey codes must return a conflict");
expect(surveyPath, survey, /engagement-survey\.created/, "survey creation must be audited");

const createQuestionPath = "app/api/engagement/surveys/[id]/questions/route.ts";
const createQuestion = await source(createQuestionPath);
expect(createQuestionPath, createQuestion, /Object\.values\(SurveyQuestionType\)/, "question type must be validated");
expect(createQuestionPath, createQuestion, /choiceTypes/, "choice questions must use explicit type-aware option validation");
expect(createQuestionPath, createQuestion, /value\.length < 2 \|\| value\.length > 20/, "choice option count must be bounded");
expect(createQuestionPath, createQuestion, /survey\.createdById !== ctx\.actorId/, "survey authoring must be creator-bound");
expect(createQuestionPath, createQuestion, /campaigns:\s*\{\s*where:\s*\{\s*status:\s*\{\s*not:\s*"DRAFT"/, "question authoring must lock after a campaign leaves DRAFT");
expect(createQuestionPath, createQuestion, /engagement-survey-question\.created/, "question creation must be audited");

const questionPath = "app/api/engagement/surveys/[id]/questions/[questionId]/route.ts";
const question = await source(questionPath);
expect(questionPath, question, /export async function PATCH/, "survey questions must support governed edits");
expect(questionPath, question, /export async function DELETE/, "survey questions must support governed deletion");
expect(questionPath, question, /loadOwnedEditableQuestion/, "question edit/delete must reuse creator and campaign lock guards");
expect(questionPath, question, /surveyAnswer\.count/, "answered questions must not be deletable");
expect(questionPath, question, /engagement-survey-question\.updated/, "question updates must be audited");
expect(questionPath, question, /engagement-survey-question\.deleted/, "question deletions must be audited");

const campaignPath = "app/api/engagement/campaigns/route.ts";
const campaign = await source(campaignPath);
expect(campaignPath, campaign, /_count:\s*\{\s*select:\s*\{\s*questions:\s*true/, "campaign creation must inspect survey question count");
expect(campaignPath, campaign, /EMPTY_SURVEY/, "campaign creation must reject surveys without authored questions");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /engagementSurvey\.findMany/, "Engagement live data must include bounded survey authoring data");
expect(dataPath, data, /editable:\s*survey\.createdById === ctx\.actorId/, "survey editing state must remain creator-bound");
expect(dataPath, data, /questions:\s*survey\.questions\.map/, "owning Engagement workspace must receive question detail");

const uiPath = "components/engagement-survey-authoring.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/api\/engagement\/surveys/, "authoring UI must create governed surveys");
expect(uiPath, ui, /\/questions/, "authoring UI must create and edit questions");
expect(uiPath, ui, /method:\s*question\.questionId \? "PATCH" : "POST"/, "authoring UI must support question create/edit");
expect(uiPath, ui, /method:\s*"DELETE"/, "authoring UI must support question deletion");
expect(uiPath, ui, /canEditSelected/, "authoring UI must respect server-computed editability");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /EngagementSurveyAuthoring/, "survey authoring must be mounted in the governed Engagement workspace");
expect(workspacePath, workspace, /surveys=\{data\.surveys\}/, "Engagement workspace must pass owning-domain survey detail only to authoring");

const continuityPath = "lib/engagement-action-center-continuity.ts";
const continuity = await source(continuityPath);
reject(continuityPath, continuity, /questionKey|prompt|dimension|SurveyQuestion|options/, "central Engagement attention must not project survey question content");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /engagement-survey-authoring:validate/, "engagement survey authoring validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*engagement-survey-authoring:validate/, "engagement survey authoring validation must run before production builds");

if (failures.length) {
  console.error("Engagement survey authoring validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Engagement survey authoring validation passed.");
