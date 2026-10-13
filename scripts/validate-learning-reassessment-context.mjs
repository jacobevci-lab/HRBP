import { readFileSync } from "node:fs";

const failures = [];
function assertContract(path, regex, reason) {
  const contents = readFileSync(path, "utf8");
  if (!regex.test(contents)) failures.push(path + ": " + reason);
}
const helper = "lib/learning-reassessment-eligibility.ts";
assertContract(helper, /developmentPlan\.status === DevelopmentPlanStatus\.ACTIVE/, "reassessment only for active development plans");
assertContract(helper, /developmentPlan\.tenantId === tenantId/, "development plan must remain in tenant");
assertContract(helper, /developmentPlan\.employmentId === employmentId/, "development plan must belong to learner");
assertContract(helper, /successionCandidate\?\.active/, "candidate removal must suppress reviews");
assertContract(helper, /successionCandidate\.plan\.active/, "inactive succession plans cannot receive reviews");
assertContract(helper, /successionCandidate\.plan\.tenantId === tenantId/, "succession plan tenant must match");
assertContract(helper, /successionCandidate\.employmentId === employmentId/, "succession candidate must belong to learner");
assertContract(helper, /hasSkillEvidence/, "source evidence required");
for (const path of [
  "app/api/learning/assignments/[id]/transition/route.ts",
  "app/api/learning/assignments/[id]/self-transition/route.ts"
]) {
  assertContract(path, /learningReassessmentEligibility\(/, "both completion endpoints must evaluate linked decision targets");
  assertContract(path, /developmentPlan: \{ select: \{[\s\S]*employmentId: true, status: true/, "plan scope and status must be read");
  assertContract(path, /successionCandidate: \{[\s\S]*plan: \{ select: \{[\s\S]*active: true/, "candidate and succession plan state must be read");
  assertContract(path, /reassessment\.developmentPlan/, "suppress closed development-plan notifications");
  assertContract(path, /reassessment\.succession/, "suppress removed or inactive succession notifications");
  assertContract(path, /developmentSkill\?\.tenantId === ctx\.tenantId/, "skill evidence must belong to tenant");
  assertContract(path, /appendAudit/, "completion must retain audit evidence");
}
if (failures.length) {
  console.error("Learning reassessment eligibility validation failed:");
  for (const problem of failures) console.error("- " + problem);
  process.exit(1);
}
console.log("Validated learning reassessment eligibility for both human and self-service completion.");
