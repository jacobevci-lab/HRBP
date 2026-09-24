import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/growth.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /successionCandidateId\s+String\?/, "learning assignments must carry optional succession candidate provenance");
expect(schemaPath, schema, /developmentSkillId\s+String\?/, "learning assignments must carry a structured development skill");
expect(schemaPath, schema, /targetProficiency\s+SkillProficiency\?/, "learning assignments must carry a governed proficiency target");
expect(schemaPath, schema, /SuccessionCandidateDevelopment/, "succession candidate and learning assignment relation must be explicit");
expect(schemaPath, schema, /LearningDevelopmentSkill/, "development skill relation must be explicit");
expect(schemaPath, schema, /@@index\(\[tenantId, successionCandidateId, status\]\)/, "succession development lookups must be indexed");

const createPath = "app/api/succession/candidates/[id]/development-assignment/route.ts";
const create = await source(createPath);
expect(createPath, create, /can\(ctx,\s*"succession:write"\)[\s\S]*can\(ctx,\s*"learning:write"\)/, "cross-domain development creation must require both write capabilities");
expect(createPath, create, /canActOnEmployment/, "candidate employment must remain relationship scoped");
expect(createPath, create, /employmentPrimaryKeyFilter\(scope\)/, "target succession position must remain relationship scoped");
expect(createPath, create, /PLAN_INACTIVE/, "inactive succession plans must reject development assignments");
expect(createPath, create, /active:\s*true/, "development assignments must use active catalog records");
expect(createPath, create, /DUPLICATE_OPEN_PLAN/, "duplicate open candidate-course-skill plans must be rejected");
expect(createPath, create, /TARGET_NOT_ABOVE_CURRENT/, "target proficiency must be above current human-assessed proficiency");
expect(createPath, create, /learning-assignment\.created-from-succession/, "learning-side audit evidence must be written");
expect(createPath, create, /succession-candidate\.development-assignment-created/, "succession-side audit evidence must be written");
expect(createPath, create, /enqueueLearningAssignmentNotification/, "new development assignments must notify the employee");

for (const transitionPath of [
  "app/api/learning/assignments/[id]/transition/route.ts",
  "app/api/learning/assignments/[id]/self-transition/route.ts"
]) {
  const transition = await source(transitionPath);
  expect(transitionPath, transition, /enqueueSuccessionDevelopmentReassessment/, "learning completion must request human succession reassessment");
  expect(transitionPath, transition, /successionCandidate[\s\S]*developmentSkill[\s\S]*targetProficiency/, "reassessment must only be queued for structured succession development assignments");
  expect(transitionPath, transition, /updateMany/, "learning transitions must remain state-aware");
}

const notificationPath = "lib/succession-development-notifications.ts";
const notification = await source(notificationPath);
expect(notificationPath, notification, /SUCCESSION_DEVELOPMENT_REASSESSMENT_REQUIRED/, "development completion must use a dedicated event");
expect(notificationPath, notification, /recipientUserId:\s*input\.ownerId/, "active succession owner must be the primary reassessment recipient");
expect(notificationPath, notification, /PlatformRole\.TALENT_ADMIN/, "Talent Admin must be the fallback reassessment recipient");
expect(notificationPath, notification, /enqueueNotificationOutbox/, "reassessment must use the durable notification outbox");
expect(notificationPath, notification, /not an automatic readiness decision/, "human decision boundary must be documented in code");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /SUCCESSION_DEVELOPMENT_REASSESSMENT_REQUIRED/, "notification center must present development reassessment events");
expect(presentationPath, presentation, /resourceType\s*===\s*"SuccessionCandidate"/, "reassessment alerts must deep-link to succession candidates");
expect(presentationPath, presentation, /Human reassessment is required|İnsan değerlendirmesi gerekiyor/, "notification copy must preserve human decision ownership");

const dataPath = "lib/succession-governance-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /latestTalent/, "succession governance must surface the latest human talent signal");
expect(dataPath, data, /developmentAssignments/, "succession governance must surface linked learning evidence");
expect(dataPath, data, /currentProficiency/, "succession governance must compare current assessed proficiency with the learning target");
expect(dataPath, data, /includeDevelopmentCatalog/, "learning mutation catalog must be conditionally loaded");
expect(dataPath, data, /employmentIdFilter\(scope\)/, "connected succession reads must preserve relationship scope");

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /allowLearningPlan\s*=\s*can\(ctx,\s*"learning:write"\)/, "succession learning-plan UI must be learning-capability gated");
expect(modulePath, modulePage, /includeDevelopmentCatalog:\s*allowLearningPlan/, "learning catalog must only load when cross-domain mutation is authorized");
expect(modulePath, modulePage, /allowLearningPlan=\{allowLearningPlan\}/, "capability decision must flow into the succession console");

const consolePath = "components/succession-governance-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /candidate\.latestTalent/, "succession UI must display the latest talent signal");
expect(consolePath, consoleSource, /candidate\.developmentAssignments/, "succession UI must display connected learning evidence");
expect(consolePath, consoleSource, /allowLearningPlan\s*\?/, "development creation form must be hidden without learning write access");
expect(consolePath, consoleSource, /development-assignment/, "succession UI must call the governed cross-domain assignment endpoint");
expect(consolePath, consoleSource, /does not automatically change|otomatik değiştirmez/, "succession UI must explain the human readiness boundary");

const lifecycleDataPath = "lib/growth-lifecycle-data.ts";
const lifecycleData = await source(lifecycleDataPath);
expect(lifecycleDataPath, lifecycleData, /successionCandidateId:\s*true/, "learning operations must expose succession provenance");
expect(lifecycleDataPath, lifecycleData, /developmentSkill:\s*\{\s*select:/, "learning operations must expose linked skill context");
expect(lifecycleDataPath, lifecycleData, /targetProficiency:\s*true/, "learning operations must expose the target proficiency");

const lifecycleConsolePath = "components/growth-lifecycle-console.tsx";
const lifecycleConsole = await source(lifecycleConsolePath);
expect(lifecycleConsolePath, lifecycleConsole, /Succession development|Yedekleme gelişimi/, "learning operations UI must label succession-derived assignments");

const participantDataPath = "lib/learning-participant-data.ts";
const participantData = await source(participantDataPath);
expect(participantDataPath, participantData, /successionCandidateId:\s*true/, "employee learning inbox must expose succession provenance");
expect(participantDataPath, participantData, /targetProficiency:\s*true/, "employee learning inbox must expose its development target");

const participantConsolePath = "components/learning-participant-console.tsx";
const participantConsole = await source(participantConsolePath);
expect(participantConsolePath, participantConsole, /Succession development|Yedekleme gelişimi/, "employee learning UI must explain succession-linked development");
expect(participantConsolePath, participantConsole, /does not automatically change|otomatik değiştirmez/, "employee UI must preserve the human decision boundary");

const seedPath = "scripts/seed-connected-growth-staging.mjs";
const seed = await source(seedPath);
expect(seedPath, seed, /successionCandidateId/, "staging seed must create connected succession-learning records");
expect(seedPath, seed, /developmentSkillId/, "staging seed must include structured development skills");
expect(seedPath, seed, /targetProficiency/, "staging seed must include proficiency targets");
expect(seedPath, seed, /assignment\.employmentId\s*!==\s*candidate\.employmentId/, "staging seed must verify candidate/assignment ownership before linking records");

if (failures.length) {
  console.error("Connected growth contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated connected growth contract: talent signals, succession development gaps, governed learning, skill targets and human readiness reassessment remain linked, scoped and auditable.");
