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

const surveyItemPath = "app/api/engagement/surveys/[id]/route.ts";
const surveyItem = await source(surveyItemPath);
expect(surveyItemPath, surveyItem, /export async function PATCH/, "survey metadata must support governed edits");
expect(surveyItemPath, surveyItem, /export async function DELETE/, "unused surveys must support governed deletion");
expect(surveyItemPath, surveyItem, /survey\.createdById !== ctx\.actorId/, "survey metadata changes must remain creator-bound");
expect(surveyItemPath, surveyItem, /campaign\.status !== "DRAFT"/, "survey metadata must lock after a campaign leaves DRAFT");
expect(surveyItemPath, surveyItem, /if \(survey\.campaigns\.length\) throw new Error\("USED"\)/, "surveys referenced by any campaign must not be deletable");
expect(surveyItemPath, surveyItem, /engagement-survey\.updated/, "survey metadata updates must be audited");
expect(surveyItemPath, surveyItem, /engagement-survey\.deleted/, "survey deletion must be audited");

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
expect(campaignPath, campaign, /anonymityThreshold must be an integer between 5 and 1000/, "campaign anonymity threshold must be bounded");
expect(campaignPath, campaign, /closesAt must be later than opensAt/, "campaign date windows must be ordered");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /engagementSurvey\.findMany/, "Engagement live data must include bounded survey authoring data");
expect(dataPath, data, /editable:\s*survey\.createdById === ctx\.actorId/, "survey editing state must remain creator-bound");
expect(dataPath, data, /campaignCount:\s*survey\.campaigns\.length/, "survey authoring data must expose campaign usage count for deletion safety");
expect(dataPath, data, /questions:\s*survey\.questions\.map/, "owning Engagement workspace must receive question detail");

const uiPath = "components/engagement-survey-authoring.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/api\/engagement\/surveys/, "authoring UI must create governed surveys");
expect(uiPath, ui, /\/questions/, "authoring UI must create and edit questions");
expect(uiPath, ui, /method:\s*question\.questionId \? "PATCH" : "POST"/, "authoring UI must support question create/edit");
expect(uiPath, ui, /method:\s*"DELETE"/, "authoring UI must support question deletion");
expect(uiPath, ui, /canEditSelected/, "authoring UI must respect server-computed editability");
expect(uiPath, ui, /method:\s*"PATCH"/, "authoring UI must support survey metadata updates");
expect(uiPath, ui, /Delete survey/, "authoring UI must surface unused-survey deletion");
expect(uiPath, ui, /selectedSurvey\.campaignCount > 0/, "survey deletion UI must fail closed when campaigns reference the survey");

const campaignUiPath = "components/engagement-campaign-create-form.tsx";
const campaignUi = await source(campaignUiPath);
expect(campaignUiPath, campaignUi, /\/api\/engagement\/campaigns/, "Engagement workspace must create governed draft campaigns");
expect(campaignUiPath, campaignUi, /eligibleSurveys/, "campaign creation UI must allow only surveys with authored questions");
expect(campaignUiPath, campaignUi, /Create draft campaign/, "campaign creation UI must preserve DRAFT lifecycle entry");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /EngagementSurveyAuthoring/, "survey authoring must be mounted in the governed Engagement workspace");
expect(workspacePath, workspace, /EngagementCampaignCreateForm/, "campaign creation must be mounted in the governed Engagement workspace");
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
