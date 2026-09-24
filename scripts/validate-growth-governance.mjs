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

const successionPath = "app/api/succession/candidates/route.ts";
const succession = await source(successionPath);
expect(successionPath, succession, /canActOnEmployment/, "successor candidates must remain relationship scoped");
expect(successionPath, succession, /PLAN_OUT_OF_SCOPE/, "succession target positions must remain inside authorized scope");

if (failures.length) {
  console.error("Growth governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated growth governance contract: write capabilities, domain isolation, relationship scope, explicit lifecycle transitions and audit evidence are enforced.");
