import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/growth.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /enum DevelopmentPlanStatus[\s\S]*DRAFT[\s\S]*ACTIVE[\s\S]*COMPLETED[\s\S]*CANCELLED/, "development plans must have an explicit lifecycle enum");
expect(schemaPath, schema, /model DevelopmentPlan[\s\S]*employmentId\s+String[\s\S]*ownerId\s+String/, "development plans must be employment and human-owner bound");
expect(schemaPath, schema, /sourceAssessmentId\s+String\?/, "development plans must preserve optional talent-assessment provenance");
expect(schemaPath, schema, /successionCandidateId\s+String\?/, "development plans must preserve optional succession provenance");
expect(schemaPath, schema, /focusSkillId\s+String\?[\s\S]*targetProficiency\s+SkillProficiency\?/, "development plans must model structured skill targets");
expect(schemaPath, schema, /developmentPlanId\s+String\?/, "learning assignments must preserve development-plan provenance");
expect(schemaPath, schema, /DevelopmentPlanLearning/, "development plan and learning assignment relation must be explicit");
expect(schemaPath, schema, /@@index\(\[tenantId, employmentId, status\]\)/, "development plan relationship-scope lookup must be indexed");

const createPath = "app/api/talent/development-plans/route.ts";
const create = await source(createPath);
expect(createPath, create, /can\(ctx,\s*"talent:write"\)/, "development plan creation must require talent:write");
expect(createPath, create, /canActOnEmployment/, "development plan creation must enforce relationship scope");
expect(createPath, create, /sourceAssessmentId[\s\S]*employmentId/, "source assessment must be bound to the same employee");
expect(createPath, create, /DUPLICATE_OPEN_PLAN/, "duplicate open skill plans must be rejected");
expect(createPath, create, /TARGET_NOT_ABOVE_CURRENT/, "skill targets must exceed the current human-assessed proficiency");
expect(createPath, create, /development-plan\.created/, "plan creation must emit audit evidence");

const updatePath = "app/api/talent/development-plans/[id]/route.ts";
const update = await source(updatePath);
expect(updatePath, update, /DRAFT:\s*\[DevelopmentPlanStatus\.ACTIVE, DevelopmentPlanStatus\.CANCELLED\]/, "development lifecycle must use explicit forward transitions");
expect(updatePath, update, /ACTIVE:\s*\[DevelopmentPlanStatus\.COMPLETED, DevelopmentPlanStatus\.CANCELLED\]/, "active development plans must only complete or cancel");
expect(updatePath, update, /LearningAssignmentStatus\.COMPLETED[\s\S]*LearningAssignmentStatus\.WAIVED/, "plan completion must wait for terminal learning actions");
expect(updatePath, update, /OUTCOME_NOTES_REQUIRED/, "plan completion must require human outcome evidence");
expect(updatePath, update, /TARGET_NOT_REASSESSED/, "plan completion must require a human-confirmed target proficiency");
expect(updatePath, update, /updateMany/, "development plan transitions must use state-aware writes");
expect(updatePath, update, /appendAudit/, "development plan lifecycle changes must emit audit evidence");

const assignmentPath = "app/api/talent/development-plans/[id]/learning-assignment/route.ts";
const assignment = await source(assignmentPath);
expect(assignmentPath, assignment, /can\(ctx,\s*"talent:write"\)[\s\S]*can\(ctx,\s*"learning:write"\)/, "cross-domain learning assignment must require both write capabilities");
expect(assignmentPath, assignment, /canActOnEmployment/, "development-plan learning assignment must enforce relationship scope");
expect(assignmentPath, assignment, /dueAt\s*>\s*plan\.targetAt/, "learning action due dates must remain within the development plan target");
expect(assignmentPath, assignment, /developmentPlanId:\s*plan\.id/, "learning action must be linked to its development plan");
expect(assignmentPath, assignment, /enqueueLearningAssignmentNotification/, "new plan learning actions must notify the employee");
expect(assignmentPath, assignment, /development-plan\.learning-assignment-created/, "plan learning linkage must emit audit evidence");

const successionAssignmentPath = "app/api/succession/candidates/[id]/development-assignment/route.ts";
const successionAssignment = await source(successionAssignmentPath);
expect(successionAssignmentPath, successionAssignment, /developmentPlan\.findFirst/, "succession development must reuse an open governed development plan when possible");
expect(successionAssignmentPath, successionAssignment, /developmentPlan\.create/, "succession development must create a governed development plan when none exists");
expect(successionAssignmentPath, successionAssignment, /developmentPlanId/, "succession learning assignments must be linked to the governed development plan");
expect(successionAssignmentPath, successionAssignment, /development-plan\.created-from-succession/, "auto-created succession development plans must emit audit evidence");

const notificationPath = "lib/development-plan-notifications.ts";
const notification = await source(notificationPath);
expect(notificationPath, notification, /DEVELOPMENT_PLAN_REASSESSMENT_REQUIRED/, "development plan learning completion must use a dedicated reassessment event");
expect(notificationPath, notification, /recipientUserId:\s*input\.ownerId/, "active development-plan owner must be the primary reassessment recipient");
expect(notificationPath, notification, /PlatformRole\.TALENT_ADMIN/, "Talent Admin must be the fallback reassessment recipient");
expect(notificationPath, notification, /not proof that a[\s\S]*skill target has been achieved/, "human skill decision boundary must be documented");

for (const transitionPath of [
  "app/api/learning/assignments/[id]/transition/route.ts",
  "app/api/learning/assignments/[id]/self-transition/route.ts"
]) {
  const transition = await source(transitionPath);
  expect(transitionPath, transition, /developmentPlan:\s*\{\s*select:/, "learning completion must load development plan provenance");
  expect(transitionPath, transition, /enqueueDevelopmentPlanReassessment/, "learning completion must request human development-plan reassessment");
  expect(transitionPath, transition, /developmentSkill[\s\S]*targetProficiency/, "reassessment must be tied to a structured skill target");
}

const dataPath = "lib/development-plan-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /resolveEmploymentScope/, "development plan reads must resolve relationship scope");
expect(dataPath, data, /employmentIdFilter\(scope\)/, "development plan reads must enforce relationship scope");
expect(dataPath, data, /learningAssignments/, "development plan data must surface linked learning evidence");
expect(dataPath, data, /employmentSkill\.findMany/, "development plan data must surface current human-assessed skill proficiency");

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /DevelopmentPlanConsole/, "talent module must surface the development plan console");
expect(modulePath, modulePage, /getDevelopmentPlanGovernanceData/, "talent module must load governed development plan data");
expect(modulePath, modulePage, /allowLearningPlan\s*=\s*can\(ctx,\s*"learning:write"\)/, "cross-domain learning actions must remain learning-write gated");

const consolePath = "components/development-plan-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/api\/talent\/development-plans/, "development plan UI must use governed plan endpoints");
expect(consolePath, consoleSource, /learning-assignment/, "development plan UI must support linked learning actions");
expect(consolePath, consoleSource, /never auto-promotes|otomatik yükseltmez/, "development plan UI must explain the human decision boundary");
expect(consolePath, consoleSource, /Human outcome|İnsan sonucu/, "development plan completion must request explicit human outcome evidence");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /DEVELOPMENT_PLAN_REASSESSMENT_REQUIRED/, "notification center must present development-plan reassessment events");
expect(presentationPath, presentation, /resourceType\s*===\s*"DevelopmentPlan"/, "development-plan alerts must deep-link to Talent");

const participantDataPath = "lib/learning-participant-data.ts";
const participantData = await source(participantDataPath);
expect(participantDataPath, participantData, /developmentPlanId:\s*true/, "employee learning inbox must preserve development plan provenance");
expect(participantDataPath, participantData, /developmentPlan:\s*\{\s*select:\s*\{\s*title:\s*true/, "employee learning inbox must expose the plan title");

const operationsDataPath = "lib/growth-lifecycle-data.ts";
const operationsData = await source(operationsDataPath);
expect(operationsDataPath, operationsData, /developmentPlanId:\s*true/, "learning operations must preserve development plan provenance");
expect(operationsDataPath, operationsData, /developmentPlan:\s*\{\s*select:\s*\{\s*title:\s*true/, "learning operations must expose the plan title");

const seedPath = "scripts/seed-connected-growth-staging.mjs";
const seed = await source(seedPath);
expect(seedPath, seed, /developmentPlan\.upsert/, "staging seed must create deterministic development plans");
expect(seedPath, seed, /developmentPlanId:\s*developmentPlan\.id/, "staging learning records must link to seeded development plans");
expect(seedPath, seed, /connectedDevelopmentPlans/, "staging seed must verify development plan coverage");

if (failures.length) {
  console.error("Development plan governance validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated development plan contract: talent provenance, relationship scope, learning evidence, human skill reassessment and auditable lifecycle governance are enforced.");
