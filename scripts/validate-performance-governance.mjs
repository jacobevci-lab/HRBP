import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /slug\s*===\s*"performance"\s*&&\s*can\(ctx,\s*"performance:write"\)/, "performance write console must require performance:write");
expect(modulePath, modulePage, /PerformanceOperationsConsole/, "authenticated performance page must expose the governed operations console");

const reviewPath = "app/api/performance/reviews/[id]/transition/route.ts";
const reviewRoute = await source(reviewPath);
expect(reviewPath, reviewRoute, /NOT_STARTED:\s*\[ReviewStatus\.SELF_REVIEW\]/, "review lifecycle must begin with self review");
expect(reviewPath, reviewRoute, /SELF_RATING_REQUIRED/, "self rating must be explicitly human-entered before manager review");
expect(reviewPath, reviewRoute, /MANAGER_RATING_REQUIRED/, "manager rating must be explicitly human-entered before calibration");
expect(reviewPath, reviewRoute, /FINAL_RATING_REQUIRED/, "final rating must be explicitly human-entered before finalization");
expect(reviewPath, reviewRoute, /canActOnEmployment/, "review transitions must enforce relationship scope");
expect(reviewPath, reviewRoute, /appendAudit/, "review transitions must emit audit evidence");

const cyclePath = "app/api/performance/cycles/[id]/transition/route.ts";
const cycleRoute = await source(cyclePath);
expect(cyclePath, cycleRoute, /DRAFT:\s*\[ReviewCycleStatus\.OPEN\]/, "cycle lifecycle must use explicit forward transitions");
expect(cyclePath, cycleRoute, /status:\s*\{\s*not:\s*ReviewStatus\.FINALIZED\s*\}/, "cycle finalization must block unfinished reviews");
expect(cyclePath, cycleRoute, /appendAudit/, "cycle transitions must emit audit evidence");

const goalPath = "app/api/performance/goals/[id]/route.ts";
const goalRoute = await source(goalPath);
expect(goalPath, goalRoute, /progress\s*<\s*0\s*\|\|\s*progress\s*>\s*100/, "goal progress must be range validated");
expect(goalPath, goalRoute, /COMPLETED,\s*GoalStatus\.CANCELLED/, "terminal goals must be immutable");
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

console.log("Validated performance governance contract: scoped writes, human-owned ratings, state transitions and audit evidence are enforced.");
