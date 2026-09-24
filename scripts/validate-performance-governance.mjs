import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /if\s*\(slug\s*===\s*"performance"\)\s*return\s*"performance:write"/, "performance must map to the performance:write capability");
expect(modulePath, modulePage, /PerformanceOperationsConsole/, "authenticated performance page must expose the governed operations console");
expect(modulePath, modulePage, /PerformanceParticipantConsole/, "performance page must expose identity-bound participant actions");
expect(modulePath, modulePage, /getPerformanceParticipantData\(ctx\)/, "participant queues must load from the signed request context");

const authorizationPath = "lib/authorization.ts";
const authorization = await source(authorizationPath);
expect(authorizationPath, authorization, /"performance:self-submit"/, "authorization must define employee self-review submission capability");
expect(authorizationPath, authorization, /"performance:manager-review"/, "authorization must define assigned-manager review capability");
expect(authorizationPath, authorization, /EMPLOYEE:[\s\S]*"performance:read"[\s\S]*"performance:self-submit"/, "employees must be able to access their own performance review flow");
expect(authorizationPath, authorization, /MANAGER:[\s\S]*"performance:manager-review"/, "managers must receive the manager-review capability");

const participantDataPath = "lib/performance-participant-data.ts";
const participantData = await source(participantDataPath);
expect(participantDataPath, participantData, /employmentId:\s*ctx\.employmentId/, "self-review queue must be bound to the signed employment identity");
expect(participantDataPath, participantData, /managerEmploymentId:\s*ctx\.employmentId/, "manager-review queue must be bound to the assigned manager employment identity");
expect(participantDataPath, participantData, /ReviewCycleStatus\.OPEN/, "participant queues must close when the review cycle leaves the open phase");

const selfPath = "app/api/performance/reviews/[id]/self-submit/route.ts";
const selfRoute = await source(selfPath);
expect(selfPath, selfRoute, /can\(ctx,\s*"performance:self-submit"\)/, "self submission must require the self-submit capability");
expect(selfPath, selfRoute, /review\.employmentId\s*!==\s*ctx\.employmentId/, "self submission must reject another employee's review");
expect(selfPath, selfRoute, /MANAGER_REQUIRED/, "self submission must not strand a review without an assigned manager");
expect(selfPath, selfRoute, /updateMany/, "self submission must use a state-aware write to avoid duplicate concurrent decisions");
expect(selfPath, selfRoute, /performance-review\.self-submitted/, "self submission must emit audit evidence");

const managerPath = "app/api/performance/reviews/[id]/manager-submit/route.ts";
const managerRoute = await source(managerPath);
expect(managerPath, managerRoute, /can\(ctx,\s*"performance:manager-review"\)/, "manager submission must require manager-review capability");
expect(managerPath, managerRoute, /review\.managerEmploymentId\s*!==\s*ctx\.employmentId/, "manager submission must reject an unassigned manager");
expect(managerPath, managerRoute, /status:\s*ReviewStatus\.MANAGER_REVIEW/, "manager submission must only consume manager-review state");
expect(managerPath, managerRoute, /updateMany/, "manager submission must use a state-aware write to avoid duplicate concurrent decisions");
expect(managerPath, managerRoute, /performance-review\.manager-submitted/, "manager submission must emit audit evidence");

const reviewPath = "app/api/performance/reviews/[id]/transition/route.ts";
const reviewRoute = await source(reviewPath);
expect(reviewPath, reviewRoute, /NOT_STARTED:\s*\[ReviewStatus\.SELF_REVIEW\]/, "governance may explicitly open a self-review phase");
expect(reviewPath, reviewRoute, /SELF_REVIEW:\s*\[\]/, "governance must not impersonate employee self submission");
expect(reviewPath, reviewRoute, /MANAGER_REVIEW:\s*\[\]/, "governance must not impersonate assigned-manager submission");
expect(reviewPath, reviewRoute, /ReviewCycleStatus\.OPEN/, "opening self review must require an open review cycle");
expect(reviewPath, reviewRoute, /ReviewCycleStatus\.CALIBRATION/, "final review decisions must require calibration cycle phase");
expect(reviewPath, reviewRoute, /FINAL_RATING_REQUIRED/, "final rating must be explicitly human-entered before finalization");
expect(reviewPath, reviewRoute, /canActOnEmployment/, "review governance transitions must enforce relationship scope");
expect(reviewPath, reviewRoute, /appendAudit/, "review governance transitions must emit audit evidence");

const createReviewPath = "app/api/performance/reviews/route.ts";
const createReviewRoute = await source(createReviewPath);
expect(createReviewPath, createReviewRoute, /managerEmploymentId:\s*true/, "review creation must load the governed employee-manager relationship");
expect(createReviewPath, createReviewRoute, /MANAGER_MISMATCH/, "review creation must reject arbitrary manager assignment");
expect(createReviewPath, createReviewRoute, /employment\.managerEmploymentId/, "review creation must default to the employee's governed manager");

const cyclePath = "app/api/performance/cycles/[id]/transition/route.ts";
const cycleRoute = await source(cyclePath);
expect(cyclePath, cycleRoute, /DRAFT:\s*\[ReviewCycleStatus\.OPEN\]/, "cycle lifecycle must use explicit forward transitions");
expect(cyclePath, cycleRoute, /PENDING_PARTICIPANTS/, "cycle calibration must wait for employee and manager decisions");
expect(cyclePath, cycleRoute, /ReviewStatus\.NOT_STARTED[\s\S]*ReviewStatus\.SELF_REVIEW[\s\S]*ReviewStatus\.MANAGER_REVIEW/, "calibration gate must cover all participant-pending review states");
expect(cyclePath, cycleRoute, /status:\s*\{\s*not:\s*ReviewStatus\.FINALIZED\s*\}/, "cycle finalization must block unfinished reviews");
expect(cyclePath, cycleRoute, /appendAudit/, "cycle transitions must emit audit evidence");

const goalPath = "app/api/performance/goals/[id]/route.ts";
const goalRoute = await source(goalPath);
expect(goalPath, goalRoute, /progress\s*<\s*0\s*\|\|\s*progress\s*>\s*100/, "goal progress must be range validated");
expect(goalPath, goalRoute, /goal\.status\s*===\s*GoalStatus\.COMPLETED\s*\|\|\s*goal\.status\s*===\s*GoalStatus\.CANCELLED/, "terminal goals must be immutable");
expect(goalPath, goalRoute, /canActOnEmployment/, "goal changes must enforce relationship scope");
expect(goalPath, goalRoute, /appendAudit/, "goal changes must emit audit evidence");

const createGoalPath = "app/api/performance/goals/route.ts";
const createGoalRoute = await source(createGoalPath);
expect(createGoalPath, createGoalRoute, /parentGoalId[\s\S]*tenantId:\s*ctx\.tenantId/, "goal hierarchy must not accept a cross-tenant parent");
expect(createGoalPath, createGoalRoute, /dueAt\s*<\s*startsAt/, "goal creation must validate date ordering");

if (failures.length) {
  console.error("Performance governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated performance governance contract: employee self decisions, assigned-manager decisions, calibration governance, relationship scope and audit evidence are enforced.");
