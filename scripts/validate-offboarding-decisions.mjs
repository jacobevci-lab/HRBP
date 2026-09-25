import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /rehireEligible\s+Boolean\?[\s\S]*rehireDecisionReason\s+String\?[\s\S]*rehireDecisionById\s+String\?[\s\S]*rehireDecisionAt\s+DateTime\?/, "rehire decision must preserve decision, rationale, actor and timestamp");
expect(schemaPath, schema, /model ExitInterview[\s\S]*classification\s+DataClassification\s+@default\(CONFIDENTIAL\)/, "exit interview must remain confidential by default");

const interviewPath = "app/api/offboarding/processes/[id]/exit-interview/route.ts";
const interview = await source(interviewPath);
expect(interviewPath, interview, /can\(ctx,\s*"offboarding:write"\)/, "exit interview recording requires offboarding write capability");
expect(interviewPath, interview, /canActOnEmployment\(scope,\s*process\.employmentId\)/, "exit interview must respect relationship scope");
expect(interviewPath, interview, /value\.length\s*>\s*10/, "exit interview themes must be bounded by count");
expect(interviewPath, interview, /asText\(item,\s*120\)/, "exit interview themes must be bounded by length");
expect(interviewPath, interview, /asOptionalText\(body\.comments,\s*4000\)/, "exit interview comments must be bounded");
expect(interviewPath, interview, /Date\.now\(\)\s*\+\s*5\s*\*\s*60\s*\*\s*1000/, "future interview timestamps must be rejected");
expect(interviewPath, interview, /interviewerId:\s*ctx\.actorId/, "interviewer identity must be server-owned");
expect(interviewPath, interview, /exitInterview\.findUnique/, "one governed interview record must be enforced before create");
expect(interviewPath, interview, /classification:\s*DataClassification\.CONFIDENTIAL/, "exit interview must be stored and audited as confidential");
expect(interviewPath, interview, /offboarding\.exit-interview-recorded/, "exit interview creation must be audited");
expect(interviewPath, interview, /feedback remains separate from rehire eligibility decision/, "audit purpose must document the human-decision boundary");
expect(interviewPath, interview, /TransactionIsolationLevel\.Serializable/, "exit interview creation must serialize concurrent writes");

const decisionPath = "app/api/offboarding/processes/[id]/rehire-decision/route.ts";
const decision = await source(decisionPath);
expect(decisionPath, decision, /const eligible\s*=\s*typeof body\.eligible === "boolean"/, "rehire eligibility must require an explicit boolean human decision");
expect(decisionPath, decision, /asText\(body\.reason,\s*2000\)/, "rehire decision rationale must be bounded");
expect(decisionPath, decision, /reason\.length\s*<\s*10/, "rehire decision must require a meaningful rationale");
expect(decisionPath, decision, /canActOnEmployment\(scope,\s*process\.employmentId\)/, "rehire decision must respect relationship scope");
expect(decisionPath, decision, /updatedAt:\s*process\.updatedAt/, "rehire revisions must use optimistic state awareness");
expect(decisionPath, decision, /rehireDecisionById:\s*ctx\.actorId[\s\S]*rehireDecisionAt:\s*now/, "rehire decision actor and timestamp must be server-owned");
expect(decisionPath, decision, /offboarding\.rehire-decision-set[\s\S]*offboarding\.rehire-decision-revised/, "initial and revised rehire decisions must have distinct audit actions");
expect(decisionPath, decision, /classification:\s*DataClassification\.CONFIDENTIAL/, "rehire decision audit must be confidential");
expectAbsent(decisionPath, decision, /wouldRecommend|exitInterview|score|modelScore|recommendationScore/i, "rehire eligibility must not be derived from interview feedback or an automated score");

const dataPath = "lib/offboarding-exit-decision-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /resolveEmploymentScope/, "sensitive exit decision data must resolve relationship scope");
expect(dataPath, data, /employmentIdFilter\(scope\)/, "sensitive process reads must be relationship scoped");
expect(dataPath, data, /employmentPrimaryKeyFilter\(scope\)/, "sensitive employee identity reads must be relationship scoped");
expect(dataPath, data, /rehireDecisionReason:[\s\S]*exitInterview:/, "decision workspace data must expose human rationale and confidential interview only to its protected loader");

const uiPath = "components/offboarding-exit-decision-console.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/exit-interview`/, "decision UI must call governed exit interview endpoint");
expect(uiPath, ui, /\/rehire-decision`/, "decision UI must call governed rehire endpoint");
expect(uiPath, ui, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "decision UI must mirror rationale bounds");
expect(uiPath, ui, /recommendation captured in the interview never changes eligibility automatically|öneri hiçbir zaman uygunluk kararını otomatik değiştirmez/, "UI must explain the interview/rehire decision boundary");
expect(uiPath, ui, /eligible:\s*eligible\s*===\s*"yes"/, "rehire mutation must use the explicit human selection");
expectAbsent(uiPath, ui, /setEligible\([^)]*wouldRecommend|wouldRecommend[^\n]*setEligible/, "interview recommendation must never populate rehire eligibility");

const loaderPath = "components/offboarding-clearance-loader.tsx";
const loader = await source(loaderPath);
expect(loaderPath, loader, /can\(ctx,\s*"offboarding:write"\)/, "sensitive exit decision console must only load for offboarding writers");
expect(loaderPath, loader, /getOffboardingExitDecisionData\(ctx\)/, "protected loader must fetch scoped exit decision data");
expect(loaderPath, loader, /OffboardingExitDecisionConsole\s+rows=\{decisions\}/, "protected loader must mount the exit decision console");

if (failures.length) {
  console.error("Offboarding decision validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding decision validation passed.");
