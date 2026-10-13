import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
for (const capability of ["benefits:write", "talent:write", "succession:write", "learning:write"]) {
  expect(modulePath, modulePage, new RegExp(capability.replace(":", "\\:")), `${capability} must guard its write console`);
}
expect(modulePath, modulePage, /getGrowthOperationsData\(ctx,\s*writeSlug\)/, "growth lookup data must be limited to the active write domain");
expect(modulePath, modulePage, /if\s*\(!ctx\)/, "public growth routes must branch before authenticated write consoles");
expect(modulePath, modulePage, /SuccessionGovernanceConsole/, "succession writers must receive the governed plan and candidate queue");
expect(modulePath, modulePage, /getSuccessionGovernanceData\(ctx[,)]/, "succession governance queue must load from signed request context");
expect(modulePath, modulePage, /LearningParticipantConsole/, "learning readers with self-progress capability must receive the employee learning inbox");
expect(modulePath, modulePage, /getLearningParticipantData\(ctx(?:,\s*focusId)?\)/, "learning participant data must load from the signed request context with optional governed exact focus");
expect(modulePath, modulePage, /can\(ctx,\s*"learning:self-progress"\)/, "learning self-service UI must be capability-gated");

const authorizationPath = "lib/authorization.ts";
const authorization = await source(authorizationPath);
expect(authorizationPath, authorization, /"learning:self-progress"/, "authorization must define employee-owned learning progress capability");
expect(authorizationPath, authorization, /EMPLOYEE:[\s\S]*"learning:read"[\s\S]*"learning:self-progress"/, "employees must receive learning read and self-progress capabilities");

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

const learningParticipantDataPath = "lib/learning-participant-data.ts";
const learningParticipantData = await source(learningParticipantDataPath);
expect(learningParticipantDataPath, learningParticipantData, /can\(ctx,\s*"learning:self-progress"\)/, "learning participant data must require the self-progress capability");
expect(learningParticipantDataPath, learningParticipantData, /employmentId:\s*ctx\.employmentId/, "learning participant data must be bound to the signed employment identity");
expect(learningParticipantDataPath, learningParticipantData, /LearningAssignmentStatus\.ASSIGNED[\s\S]*LearningAssignmentStatus\.IN_PROGRESS[\s\S]*LearningAssignmentStatus\.OVERDUE/, "learning participant inbox must expose only actionable employee states");

const learningSelfPath = "app/api/learning/assignments/[id]/self-transition/route.ts";
const learningSelf = await source(learningSelfPath);
expect(learningSelfPath, learningSelf, /can\(ctx,\s*"learning:self-progress"\)/, "employee learning transitions must require self-progress capability");
expect(learningSelfPath, learningSelf, /assignment\.employmentId\s*!==\s*ctx\.employmentId/, "employee learning transitions must reject another employee's assignment");
expect(learningSelfPath, learningSelf, /ASSIGNED:\s*\[LearningAssignmentStatus\.IN_PROGRESS\]/, "employees may only start an assigned learning item");
expect(learningSelfPath, learningSelf, /IN_PROGRESS:\s*\[LearningAssignmentStatus\.COMPLETED\]/, "employees may only complete an in-progress learning item");
expect(learningSelfPath, learningSelf, /WAIVED:\s*\[\]/, "employees must not self-waive learning obligations");
expect(learningSelfPath, learningSelf, /updateMany/, "employee learning transitions must use a state-aware write");
expect(learningSelfPath, learningSelf, /score\s*<\s*0\s*\|\|\s*score\s*>\s*100/, "employee completion score must be bounded");
expect(learningSelfPath, learningSelf, /learning-assignment\.self-transition/, "employee learning transitions must emit explicit audit evidence");

const learningParticipantConsolePath = "components/learning-participant-console.tsx";
const learningParticipantConsole = await source(learningParticipantConsolePath);
expect(learningParticipantConsolePath, learningParticipantConsole, /\/self-transition/, "employee learning console must use the identity-bound endpoint");
expect(learningParticipantConsolePath, learningParticipantConsole, /status:\s*next/, "employee learning console must submit an explicit next state");
expect(learningParticipantConsolePath, learningParticipantConsole, /certificateReference/, "employee learning console must support completion evidence reference");

const learningNotificationPath = "lib/learning-notifications.ts";
const learningNotifications = await source(learningNotificationPath);
expect(learningNotificationPath, learningNotifications, /workEmail:\s*true/, "learning notifications must resolve user identity from employment work email");
expect(learningNotificationPath, learningNotifications, /userAccount\.findFirst/, "learning notifications must resolve a provisioned platform account");
expect(learningNotificationPath, learningNotifications, /tenantId:\s*input\.tenantId[\s\S]*active:\s*true/, "learning notification recipients must be active and tenant-scoped");
expect(learningNotificationPath, learningNotifications, /LEARNING_ASSIGNMENT_READY/, "new learning assignments must have a dedicated notification event");
expect(learningNotificationPath, learningNotifications, /enqueueNotificationOutbox/, "learning assignment notification must use the durable outbox");

const learningCreatePath = "app/api/learning/assignments/route.ts";
const learningCreate = await source(learningCreatePath);
expect(learningCreatePath, learningCreate, /enqueueLearningAssignmentNotification/, "learning assignment creation must notify the employee identity");
expect(learningCreatePath, learningCreate, /dueAt must be a valid date/, "learning assignment due dates must be validated");
expect(learningCreatePath, learningCreate, /appendAudit/, "learning assignment creation must emit audit evidence");

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
expect(successionCreatePath, successionCreate, /asOptionalText\(body\.readinessReason, 2000\)/, "candidate creation/reactivation must require bounded readiness rationale");
expect(successionCreatePath, successionCreate, /readinessReason\.length < 12/, "candidate creation/reactivation must require meaningful human readiness rationale");
expect(successionCreatePath, successionCreate, /active:\s*true[\s\S]*removedAt:\s*null[\s\S]*removedById:\s*null[\s\S]*removalReason:\s*null/, "re-adding a removed candidate must explicitly reactivate the same historical record");
expect(successionCreatePath, successionCreate, /succession-candidate\.reactivated/, "candidate reactivation must emit explicit audit evidence");
expect(successionCreatePath, successionCreate, /where:\s*\{[\s\S]*active:\s*true[\s\S]*rank/, "candidate rank collisions must ignore removed historical candidates");

const successionCandidatePath = "app/api/succession/candidates/[id]/route.ts";
const successionCandidate = await source(successionCandidatePath);
expect(successionCandidatePath, successionCandidate, /export async function PATCH/, "successor candidates must support governed readiness updates");
expect(successionCandidatePath, successionCandidate, /export async function DELETE/, "successor candidates must support explicit removal");
expect(successionCandidatePath, successionCandidate, /canActOnEmployment/, "candidate maintenance must remain relationship scoped");
expect(successionCandidatePath, successionCandidate, /RANK_CONFLICT/, "candidate maintenance must prevent rank collisions");
expect(successionCandidatePath, successionCandidate, /succession-candidate\.removed/, "candidate removal must emit audit evidence");
expect(successionCandidatePath, successionCandidate, /expectedUpdatedAt/, "candidate maintenance must require optimistic concurrency evidence");
expect(successionCandidatePath, successionCandidate, /readinessChanged[\s\S]*readinessReason\.length < 12/, "readiness changes must require a meaningful human decision reason");
expect(successionCandidatePath, successionCandidate, /asOptionalText\(body\.readinessReason, 2000\)/, "readiness decision reasons must be bounded to 2000 characters");
expect(successionCandidatePath, successionCandidate, /asOptionalText\(body\.developmentGap, 2000\)/, "development gaps must be bounded without silent truncation");
expect(successionCandidatePath, successionCandidate, /updateMany\([\s\S]*updatedAt:\s*candidate\.updatedAt/, "candidate updates must use state-aware optimistic concurrency");
expect(successionCandidatePath, successionCandidate, /readinessReviewedAt:[\s\S]*readinessReviewedById:\s*ctx\.actorId/, "readiness decisions must persist human reviewer provenance");
expect(successionCandidatePath, successionCandidate, /succession-candidate\.readiness-reviewed/, "readiness changes must emit a dedicated audit event");
expect(successionCandidatePath, successionCandidate, /previous=\$\{candidate\.readiness\}; next=\$\{readiness\}; reasonRecorded=true/, "readiness audit evidence must record decision shape without copying the reason text");
expect(successionCandidatePath, successionCandidate, /STALE_STATE/, "concurrent candidate updates must fail with a bounded stale-state conflict");
expect(successionCandidatePath, successionCandidate, /CANDIDATE_INACTIVE/, "removed candidates must be immutable until explicitly reactivated");
expect(successionCandidatePath, successionCandidate, /Removing a succession candidate requires a reason of at least 12 characters/, "candidate removal must require explicit human rationale");
expect(successionCandidatePath, successionCandidate, /asOptionalText\(body\.removalReason, 2000\)/, "candidate removal rationale must be bounded");
expect(successionCandidatePath, successionCandidate, /active:\s*false[\s\S]*removedAt[\s\S]*removedById:\s*ctx\.actorId[\s\S]*removalReason[\s\S]*rank:\s*null/, "candidate removal must preserve the record while clearing it from the active ranked pipeline");
expect(successionCandidatePath, successionCandidate, /historyPreserved=true/, "candidate removal audit must explicitly record non-destructive history preservation");
expectAbsent(successionCandidatePath, successionCandidate, /successionCandidate\.delete\(/, "succession candidate removal must never hard-delete governed history");

const successionPlanPath = "app/api/succession/plans/route.ts";
const successionPlan = await source(successionPlanPath);
expect(successionPlanPath, successionPlan, /ownerId:\s*ctx\.actorId/, "new succession plans must bind ownership to the signed actor");
expect(successionPlanPath, successionPlan, /reviewDueAt must be a future date within 730 days/, "succession plan creation must require a bounded future review date");
expect(successionPlanPath, successionPlan, /succession-plan\.created/, "new succession plans must emit explicit audit evidence");
expect(successionPlanPath, successionPlan, /asIdentifier\(body\.positionId\)/, "succession plan creation must validate position identifiers");
expect(successionPlanPath, successionPlan, /asOptionalText\(body\.name, 180\)/, "succession plan names must be bounded without silent truncation");
expect(successionPlanPath, successionPlan, /730 \* 24 \* 60 \* 60 \* 1000/, "initial succession review date must be bounded to two years");
expect(successionPlanPath, successionPlan, /successionPlan\.findUnique/, "succession creation must detect an existing position plan before writing");
expect(successionPlanPath, successionPlan, /PLAN_EXISTS/, "existing succession plans must use governed maintenance instead of silent reactivation");
expect(successionPlanPath, successionPlan, /successionPlan\.create\(/, "initial succession plan must use create-only persistence");
expect(successionPlanPath, successionPlan, /P2002/, "concurrent duplicate creation must become a bounded conflict");
expectAbsent(successionPlanPath, successionPlan, /successionPlan\.upsert\(/, "succession creation must not bypass lifecycle governance");
expect(successionPlanPath, successionPlan, /status:\s*\{\s*not:\s*PositionStatus\.CLOSED\s*\}/, "succession creation must reject closed positions");
expect(successionPlanPath, successionPlan, /validTo:\s*null/, "succession creation must require current positions");
expect(successionPlanPath, successionPlan, /take:\s*200/, "succession read API must remain bounded");
expect(successionPlanPath, successionPlan, /candidates:\s*\{\s*where:\s*\{\s*active:\s*true,/, "succession read API must exclude removed candidates");
expect(successionPlanPath, successionPlan, /"cache-control":\s*"no-store"/, "succession read API must not cache confidential candidate records");

const successionPlanUpdatePath = "app/api/succession/plans/[id]/route.ts";
const successionPlanUpdate = await source(successionPlanUpdatePath);
expect(successionPlanUpdatePath, successionPlanUpdate, /can\(ctx,\s*"succession:write"\)/, "succession plan maintenance must require succession:write");
expect(successionPlanUpdatePath, successionPlanUpdate, /employmentPrimaryKeyFilter\(scope\)/, "succession plan maintenance must verify target position scope");
expect(successionPlanUpdatePath, successionPlanUpdate, /succession-plan\.deactivated/, "succession plans must support auditable deactivation");
expect(successionPlanUpdatePath, successionPlanUpdate, /succession-plan\.reactivated/, "succession plans must support auditable reactivation");

const successionReviewPath = "app/api/succession/plans/[id]/review/route.ts";
const successionReview = await source(successionReviewPath);
expect(successionReviewPath, successionReview, /can\(ctx,\s*"succession:write"\)/, "succession review attestation must require succession:write");
expect(successionReviewPath, successionReview, /mutationOriginAllowed\(request\)/, "succession review attestation must enforce same-origin mutation");
expect(successionReviewPath, successionReview, /summary\.length < 12/, "succession review attestation must require a meaningful human summary");
expect(successionReviewPath, successionReview, /asText\(body\.summary, 2000\)/, "succession review summary must be bounded to 2000 characters");
expect(successionReviewPath, successionReview, /730 \* 24 \* 60 \* 60 \* 1000/, "next succession review must be bounded to two years");
expect(successionReviewPath, successionReview, /expectedUpdatedAt/, "succession review attestation must require optimistic concurrency evidence");
expect(successionReviewPath, successionReview, /!plan\.active/, "inactive succession plans must reject review attestation");
expect(successionReviewPath, successionReview, /resolveEmploymentScope/, "succession review attestation must preserve relationship scope");
expect(successionReviewPath, successionReview, /updateMany\([\s\S]*active:\s*true[\s\S]*updatedAt:\s*plan\.updatedAt/, "succession review attestation must use active-state and updatedAt evidence to reject stale writes");
expect(successionReviewPath, successionReview, /lastReviewedAt:[\s\S]*lastReviewedById:\s*ctx\.actorId[\s\S]*lastReviewSummary:\s*summary[\s\S]*reviewDueAt/, "succession review attestation must persist reviewer, timestamp, summary and next review");
expect(successionReviewPath, successionReview, /succession-plan\.review-attested/, "succession review attestation must emit explicit audit evidence");
expect(successionReviewPath, successionReview, /summaryRecorded=true/, "succession review audit must record summary presence without copying summary text");
expect(successionReviewPath, successionReview, /STALE_STATE/, "concurrent succession review attestation must fail with a bounded stale-state conflict");
expect(successionReviewPath, successionReview, /successionCandidate\.count\([\s\S]*active:\s*true/, "succession plan review evidence must count active candidates only");

const successionSchemaPath = "prisma/growth.prisma";
const successionSchema = await source(successionSchemaPath);
expect(successionSchemaPath, successionSchema, /model SuccessionPlan[\s\S]*lastReviewedAt\s+DateTime\?[\s\S]*lastReviewedById\s+String\?[\s\S]*lastReviewSummary\s+String\?/, "succession plans must persist human review attestation evidence");
const successionMigrationPath = "prisma/migrations/20261012113000_succession_review_attestation/migration.sql";
const successionMigration = await source(successionMigrationPath);
expect(successionMigrationPath, successionMigration, /ADD COLUMN "lastReviewedAt"[\s\S]*ADD COLUMN "lastReviewedById"[\s\S]*ADD COLUMN "lastReviewSummary"/, "succession review attestation must be delivered through a versioned migration");
expect(successionSchemaPath, successionSchema, /model SuccessionCandidate[\s\S]*readinessReason\s+String\?[\s\S]*readinessReviewedAt\s+DateTime\?[\s\S]*readinessReviewedById\s+String\?[\s\S]*updatedAt\s+DateTime\s+@updatedAt/, "successor candidates must persist human readiness decision provenance and concurrency state");
const readinessMigrationPath = "prisma/migrations/20261012153000_succession_readiness_decision/migration.sql";
const readinessMigration = await source(readinessMigrationPath);
expect(readinessMigrationPath, readinessMigration, /ADD COLUMN "readinessReason"[\s\S]*ADD COLUMN "readinessReviewedAt"[\s\S]*ADD COLUMN "readinessReviewedById"[\s\S]*ADD COLUMN "updatedAt"/, "readiness decision governance must be delivered through a versioned migration");
expect(readinessMigrationPath, readinessMigration, /UPDATE "SuccessionCandidate"[\s\S]*SET "updatedAt" = "addedAt"[\s\S]*ALTER COLUMN "updatedAt" SET NOT NULL/, "readiness migration must safely backfill optimistic concurrency state for existing candidates");
expect(successionSchemaPath, successionSchema, /model SuccessionCandidate[\s\S]*active\s+Boolean\s+@default\(true\)[\s\S]*removedAt\s+DateTime\?[\s\S]*removedById\s+String\?[\s\S]*removalReason\s+String\?/, "successor candidates must preserve non-destructive removal lifecycle evidence");
const candidateLifecycleMigrationPath = "prisma/migrations/20261012164500_succession_candidate_lifecycle/migration.sql";
const candidateLifecycleMigration = await source(candidateLifecycleMigrationPath);
expect(candidateLifecycleMigrationPath, candidateLifecycleMigration, /ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true[\s\S]*ADD COLUMN "removedAt"[\s\S]*ADD COLUMN "removedById"[\s\S]*ADD COLUMN "removalReason"/, "candidate lifecycle must be delivered through a versioned migration");

const successionDataPath = "lib/succession-governance-data.ts";
const successionData = await source(successionDataPath);
expect(successionDataPath, successionData, /resolveEmploymentScope/, "succession governance data must resolve relationship scope");
expect(successionDataPath, successionData, /employmentIdFilter\(scope\)/, "successor queue must filter candidate employment scope");
expect(successionDataPath, successionData, /overdue:\s*Boolean/, "succession governance data must identify overdue plan reviews");
expect(successionDataPath, successionData, /lastReviewedAt:\s*true/, "succession governance data must load the latest review timestamp");
expect(successionDataPath, successionData, /lastReviewedById:\s*true/, "succession governance data must load reviewer identity provenance");
expect(successionDataPath, successionData, /lastReviewSummary:\s*true/, "succession governance data must load the bounded human review summary");
expect(successionDataPath, successionData, /userAccount\.findMany/, "succession governance data must resolve reviewer actor display names tenant-locally");
expect(successionDataPath, successionData, /updatedAt:\s*plan\.updatedAt\.toISOString\(\)/, "succession governance UI must receive concurrency evidence for review attestation");
expect(successionDataPath, successionData, /readinessReason:\s*true/, "succession governance data must load human readiness rationale");
expect(successionDataPath, successionData, /readinessReviewedAt:\s*true/, "succession governance data must load readiness decision timestamps");
expect(successionDataPath, successionData, /readinessReviewedById:\s*true/, "succession governance data must load readiness reviewer identity");
expect(successionDataPath, successionData, /updatedAt:\s*candidate\.updatedAt\.toISOString\(\)/, "candidate UI must receive optimistic concurrency evidence");
expect(successionDataPath, successionData, /readinessReviewedBy:[\s\S]*reviewerMap\.get\(candidate\.readinessReviewedById\)/, "readiness reviewer identity must resolve tenant-locally for the governance UI");
expect(successionDataPath, successionData, /candidates:\s*\{[\s\S]*where:\s*\{\s*active:\s*true,\s*\.\.\.employmentIdFilter\(scope\)\s*\}/, "succession governance queue must show active candidates only");

const successionConsolePath = "components/succession-governance-console.tsx";
const successionConsole = await source(successionConsolePath);
expect(successionConsolePath, successionConsole, /\/api\/succession\/plans\/\$\{plan\.id\}/, "succession console must use governed plan update endpoint");
expect(successionConsolePath, successionConsole, /\/api\/succession\/candidates\/\$\{candidate\.id\}/, "succession console must use governed candidate endpoint");
expect(successionConsolePath, successionConsole, /"PATCH"/, "succession console must use explicit patch mutations");
expect(successionConsolePath, successionConsole, /"DELETE"/, "succession console must expose explicit candidate removal");
expect(successionConsolePath, successionConsole, /\/api\/succession\/plans\/\$\{plan\.id\}\/review/, "succession console must use the governed review attestation endpoint");
expect(successionConsolePath, successionConsole, /expectedUpdatedAt:\s*plan\.updatedAt/, "succession review UI must submit optimistic concurrency evidence");
expect(successionConsolePath, successionConsole, /name="summary"[\s\S]*minLength=\{12\}[\s\S]*maxLength=\{2000\}/, "succession review UI must mirror bounded summary requirements");
expect(successionConsolePath, successionConsole, /name="nextReviewDueAt"[\s\S]*type="date"[\s\S]*required/, "succession review UI must require the next review date");
expect(successionConsolePath, successionConsole, /plan\.lastReviewedAt[\s\S]*plan\.lastReviewedBy[\s\S]*plan\.lastReviewSummary/, "succession UI must surface prior human review evidence");
expect(successionConsolePath, successionConsole, /readinessReason:\s*data\.get\("readinessReason"\)/, "succession UI must submit the human readiness decision reason");
expect(successionConsolePath, successionConsole, /expectedUpdatedAt:\s*candidate\.updatedAt/, "candidate UI must submit optimistic concurrency evidence");
expect(successionConsolePath, successionConsole, /name="readinessReason"[\s\S]*maxLength=\{2000\}/, "readiness reason input must mirror the bounded backend contract");
expect(successionConsolePath, successionConsole, /candidate\.readinessReviewedAt[\s\S]*candidate\.readinessReviewedBy[\s\S]*candidate\.readinessReason/, "succession UI must surface prior readiness decision provenance");
expect(successionConsolePath, successionConsole, /name="removalReason"[\s\S]*maxLength=\{2000\}/, "succession UI must collect bounded candidate removal rationale");
expect(successionConsolePath, successionConsole, /removalReason:\s*reason[\s\S]*expectedUpdatedAt:\s*candidate\.updatedAt/, "candidate removal UI must submit reason and optimistic concurrency evidence");
expectAbsent(successionConsolePath, successionConsole, /window\.confirm\(/, "candidate removal must not depend on browser-native confirmation dialogs");

const growthOperationsPath = "components/growth-operations-console.tsx";
const growthOperations = await source(growthOperationsPath);
expect(growthOperationsPath, growthOperations, /readinessReason:\s*data\.get\("readinessReason"\)/, "candidate creation UI must submit human readiness rationale");
expect(growthOperationsPath, growthOperations, /name="readinessReason"[\s\S]*required[\s\S]*minLength=\{12\}[\s\S]*maxLength=\{2000\}/, "candidate creation UI must mirror bounded readiness-rationale requirements");
expect(growthOperationsPath, growthOperations, /Create-only continuity record|Yalnızca ilk süreklilik kaydı/, "succession creation UI must disclose create-only behavior");
expect(growthOperationsPath, growthOperations, /name="name"[\s\S]*maxLength=\{180\}/, "succession plan name UI must mirror the bound");
expect(growthOperationsPath, growthOperations, /name="reviewDueAt"[\s\S]*type="date"[\s\S]*required/, "succession plan creation must require an initial review date");

const growthLivePath = "lib/growth-live-data.ts";
const growthLive = await source(growthLivePath);
expect(growthLivePath, growthLive, /candidates:\s*\{[\s\S]*where:\s*\{\s*active:\s*true,\s*\.\.\.employmentIdFilter\(scope\)\s*\}/, "succession coverage metrics must exclude removed historical candidates");

const successionDevelopmentPath = "app/api/succession/candidates/[id]/development-assignment/route.ts";
const successionDevelopment = await source(successionDevelopmentPath);
expect(successionDevelopmentPath, successionDevelopment, /CANDIDATE_INACTIVE/, "removed candidates must reject new development assignments");

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
expect(presentationPath, presentation, /LEARNING_ASSIGNMENT_READY/, "notification center must present learning assignment actions");
expect(presentationPath, presentation, /resourceType\s*===\s*"LearningAssignment"/, "learning notifications must deep-link to the learning workspace");
expect(presentationPath, presentation, /SUCCESSION_PLAN_REVIEW_DUE_SOON/, "notification center must present succession due-soon reminders");
expect(presentationPath, presentation, /SUCCESSION_PLAN_REVIEW_OVERDUE/, "notification center must present succession overdue reminders");
expect(presentationPath, presentation, /resourceType\s*===\s*"SuccessionPlan"/, "succession notifications must deep-link to succession workspace");

if (failures.length) {
  console.error("Growth governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated growth governance contract: write capabilities, relationship scope, employee-owned learning progress, succession plan ownership, candidate rank integrity, reminder delivery, explicit lifecycle transitions and audit evidence are enforced.");
