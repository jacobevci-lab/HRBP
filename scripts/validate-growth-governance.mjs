import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
for (const capability of ["benefits:write", "talent:write", "succession:write", "learning:write"]) {
  expect(modulePath, modulePage, new RegExp(capability.replace(":", "\\:")), `${capability} must guard its write console`);
}
expect(modulePath, modulePage, /getGrowthOperationsData\(ctx,\s*writeSlug\)/, "growth lookup data must be limited to the active write domain");
expect(modulePath, modulePage, /if\s*\(!ctx\)/, "public growth routes must branch before authenticated write consoles");
expect(modulePath, modulePage, /SuccessionGovernanceConsole/, "succession writers must receive the governed plan and candidate queue");
expect(modulePath, modulePage, /getSuccessionGovernanceData\(ctx\)/, "succession governance queue must load from signed request context");

const operationsPath = "lib/growth-operations-data.ts";
const operations = await source(operationsPath);
expect(operationsPath, operations, /slug\s*===\s*"benefits"\s*\?\s*(?:await\s+)?db\.benefitPlan\.findMany/, "benefit plan options must only load in benefits operations");
expect(operationsPath, operations, /slug\s*===\s*"succession"\s*\?\s*(?:await\s+)?db\.successionPlan\.findMany/, "succession options must only load in succession operations");
expect(operationsPath, operations, /slug\s*===\s*"learning"\s*\?\s*(?:await\s+)?db\.learningCourse\.findMany/, "learning options must only load in learning operations");
expect(operationsPath, operations, /resolveEmploymentScope/, "growth employee selectors must remain relationship scoped");

const benefitsPath = "app/api/benefits/enrollments/[id]/transition/route.ts";
const benefits = await source(benefitsPath);
expect(benefitsPath, benefits, /can\(ctx,\s*"benefits:write"\)/, "benefit transitions must require benefits:write");
expect(benefitsPath, benefits, /canActOnEmployment/, "benefit transitions must enforce relationship scope");
expect(benefitsPath, benefits, /PENDING:\s*\[BenefitEnrollmentStatus\.ACTIVE/, "benefit lifecycle must use explicit state transitions");
expect(benefitsPath, benefits, /appendAudit/, "benefit transitions must emit audit evidence");

const learningPath = "app/api/learning/assignments/[id]/transition/route.ts";
const learning = await source(learningPath);
expect(learningPath, learning, /can\(ctx,\s*"learning:write"\)/, "learning transitions must require learning:write");
expect(learningPath, learning, /canActOnEmployment/, "learning transitions must enforce relationship scope");
expect(learningPath, learning, /COMPLETED:\s*\[\]/, "completed learning assignments must be terminal");
expect(learningPath, learning, /score\s*<\s*0\s*\|\|\s*score\s*>\s*100/, "learning completion scores must be bounded");
expect(learningPath, learning, /appendAudit/, "learning transitions must emit audit evidence");

const talentPath = "app/api/talent/assessments/route.ts";
const talent = await source(talentPath);
expect(talentPath, talent, /assessedById:\s*ctx\.actorId/, "talent assessment must preserve the human assessor identity");
expect(talentPath, talent, /canActOnEmployment/, "talent assessments must enforce relationship scope");

const successionCreatePath = "app/api/succession/candidates/route.ts";
const successionCreate = await source(successionCreatePath);
expect(successionCreatePath, successionCreate, /canActOnEmployment/, "successor candidates must remain relationship scoped");
expect(successionCreatePath, successionCreate, /PLAN_OUT_OF_SCOPE/, "succession target positions must remain inside authorized scope");
expect(successionCreatePath, successionCreate, /PLAN_INACTIVE/, "inactive succession plans must reject candidate changes");
expect(successionCreatePath, successionCreate, /rank\s*<\s*1\s*\|\|\s*rank\s*>\s*99/, "candidate rank must be bounded");
expect(successionCreatePath, successionCreate, /RANK_CONFLICT/, "candidate ranks must remain unique inside a plan");
expect(successionCreatePath, successionCreate, /succession-candidate\.added/, "new successor candidates must emit explicit audit evidence");

const successionCandidatePath = "app/api/succession/candidates/[id]/route.ts";
const successionCandidate = await source(successionCandidatePath);
expect(successionCandidatePath, successionCandidate, /export async function PATCH/, "successor candidates must support governed readiness updates");
expect(successionCandidatePath, successionCandidate, /export async function DELETE/, "successor candidates must support explicit removal");
expect(successionCandidatePath, successionCandidate, /canActOnEmployment/, "candidate maintenance must remain relationship scoped");
expect(successionCandidatePath, successionCandidate, /RANK_CONFLICT/, "candidate maintenance must prevent rank collisions");
expect(successionCandidatePath, successionCandidate, /succession-candidate\.removed/, "candidate removal must emit audit evidence");

const successionPlanPath = "app/api/succession/plans/route.ts";
const successionPlan = await source(successionPlanPath);
expect(successionPlanPath, successionPlan, /ownerId:\s*ctx\.actorId/, "new succession plans must bind ownership to the signed actor");
expect(successionPlanPath, successionPlan, /reviewDueAt must be a valid date/, "succession plan review dates must be validated");
expect(successionPlanPath, successionPlan, /succession-plan\.created/, "new succession plans must emit explicit audit evidence");

const successionPlanUpdatePath = "app/api/succession/plans/[id]/route.ts";
const successionPlanUpdate = await source(successionPlanUpdatePath);
expect(successionPlanUpdatePath, successionPlanUpdate, /can\(ctx,\s*"succession:write"\)/, "succession plan maintenance must require succession:write");
expect(successionPlanUpdatePath, successionPlanUpdate, /employmentPrimaryKeyFilter\(scope\)/, "succession plan maintenance must verify target position scope");
expect(successionPlanUpdatePath, successionPlanUpdate, /succession-plan\.deactivated/, "succession plans must support auditable deactivation");
expect(successionPlanUpdatePath, successionPlanUpdate, /succession-plan\.reactivated/, "succession plans must support auditable reactivation");

const successionDataPath = "lib/succession-governance-data.ts";
const successionData = await source(successionDataPath);
expect(successionDataPath, successionData, /resolveEmploymentScope/, "succession governance data must resolve relationship scope");
expect(successionDataPath, successionData, /employmentIdFilter\(scope\)/, "successor queue must filter candidate employment scope");
expect(successionDataPath, successionData, /overdue:\s*Boolean/, "succession governance data must identify overdue plan reviews");

const successionConsolePath = "components/succession-governance-console.tsx";
const successionConsole = await source(successionConsolePath);
expect(successionConsolePath, successionConsole, /\/api\/succession\/plans\/\$\{plan\.id\}/, "succession console must use governed plan update endpoint");
expect(successionConsolePath, successionConsole, /\/api\/succession\/candidates\/\$\{candidate\.id\}/, "succession console must use governed candidate endpoint");
expect(successionConsolePath, successionConsole, /"PATCH"/, "succession console must use explicit patch mutations");
expect(successionConsolePath, successionConsole, /"DELETE"/, "succession console must expose explicit candidate removal");

const reminderPath = "lib/succession-reminders.ts";
const reminders = await source(reminderPath);
expect(reminderPath, reminders, /HRBP_SUCCESSION_REVIEW_WARNING_DAYS/, "succession reminder window must be runtime configurable");
expect(reminderPath, reminders, /ownerId:\s*\{\s*not:\s*null\s*\}/, "succession reminders must only scan owned plans");
expect(reminderPath, reminders, /userAccount\.findFirst/, "succession reminders must verify an active owner account");
expect(reminderPath, reminders, /SUCCESSION_PLAN_REVIEW_OVERDUE/, "overdue succession reviews must generate reminders");
expect(reminderPath, reminders, /SUCCESSION_PLAN_REVIEW_DUE_SOON/, "due-soon succession reviews must generate reminders");
expect(reminderPath, reminders, /enqueueNotificationOutbox/, "succession reminders must use the durable notification outbox");

const maintenancePath = "app/api/internal/maintenance/route.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /queueSuccessionReviewReminders/, "internal maintenance must queue succession review reminders");
expect(maintenancePath, maintenance, /successionReminders/, "maintenance response must expose succession reminder results");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /SUCCESSION_PLAN_REVIEW_DUE_SOON/, "notification center must present succession due-soon reminders");
expect(presentationPath, presentation, /SUCCESSION_PLAN_REVIEW_OVERDUE/, "notification center must present succession overdue reminders");
expect(presentationPath, presentation, /resourceType\s*===\s*"SuccessionPlan"/, "succession notifications must deep-link to succession workspace");

if (failures.length) {
  console.error("Growth governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated growth governance contract: write capabilities, relationship scope, succession plan ownership, candidate rank integrity, reminder delivery, explicit lifecycle transitions and audit evidence are enforced.");
