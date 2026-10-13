import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /TalentGovernanceConsole/, "talent write users must receive the human assessment governance console");
expect(modulePath, modulePage, /getTalentGovernanceData\(ctx\)/, "talent governance data must load from the signed request context");
expect(modulePath, modulePage, /LearningGovernanceConsole/, "learning write users must receive catalog and proficiency governance controls");
expect(modulePath, modulePage, /getLearningGovernanceData\(ctx\)/, "learning governance data must load from the signed request context");

const talentCreatePath = "app/api/talent/assessments/route.ts";
const talentCreate = await source(talentCreatePath);
expect(talentCreatePath, talentCreate, /can\(ctx,\s*"talent:write"\)/, "talent creation must require talent:write");
expect(talentCreatePath, talentCreate, /canActOnEmployment/, "talent creation must remain relationship scoped");
expect(talentCreatePath, talentCreate, /asIdentifier\(body\.employmentId\)/, "talent creation must validate employment identifiers");
expect(talentCreatePath, talentCreate, /asText\(body\.cycleLabel, 160\)/, "talent cycle labels must be bounded");
expect(talentCreatePath, talentCreate, /asOptionalText\(body\.notes, 4000\)/, "initial talent notes must be bounded without silent truncation");
expect(talentCreatePath, talentCreate, /typeof criticalTalent !== "boolean"/, "critical-talent input must remain explicitly boolean");
expect(talentCreatePath, talentCreate, /talentAssessment\.findUnique/, "talent creation must detect an existing employee-cycle record before writing");
expect(talentCreatePath, talentCreate, /ASSESSMENT_EXISTS/, "existing talent records must be routed to governed correction instead of overwritten");
expect(talentCreatePath, talentCreate, /talentAssessment\.create\(/, "initial talent assessment must use create-only persistence");
expect(talentCreatePath, talentCreate, /P2002/, "concurrent duplicate assessment creation must collapse to a bounded conflict");
expect(talentCreatePath, talentCreate, /talent-assessment\.recorded/, "initial talent assessment must emit explicit audit evidence");
expect(talentCreatePath, talentCreate, /Initial human talent assessment[\s\S]*performance=\$\{performance\}[\s\S]*potential=\$\{potential\}/, "initial talent audit must capture decision shape without copying notes");
expectAbsent(talentCreatePath, talentCreate, /talentAssessment\.upsert\(/, "talent creation endpoint must not bypass correction governance with an upsert");

const talentPatchPath = "app/api/talent/assessments/[id]/route.ts";
const talentPatch = await source(talentPatchPath);
expect(talentPatchPath, talentPatch, /can\(ctx,\s*"talent:write"\)/, "talent corrections must require talent:write");
expect(talentPatchPath, talentPatch, /canActOnEmployment/, "talent corrections must enforce relationship scope");
expect(talentPatchPath, talentPatch, /assessedById:\s*ctx\.actorId/, "talent corrections must bind the human assessor identity");
expect(talentPatchPath, talentPatch, /talent-assessment\.corrected/, "talent corrections must emit explicit audit evidence");
expect(talentPatchPath, talentPatch, /expectedAssessedAt/, "talent corrections must require optimistic concurrency evidence");
expect(talentPatchPath, talentPatch, /asOptionalText\(body\.notes, 4000\)/, "talent correction notes must be bounded without silent truncation");
expect(talentPatchPath, talentPatch, /asOptionalText\(body\.correctionReason, 2000\)/, "material talent correction reasons must be bounded");
expect(talentPatchPath, talentPatch, /decisionChanged[\s\S]*correctionReason\.length < 12/, "material talent decisions must require a meaningful correction reason");
expect(talentPatchPath, talentPatch, /updateMany\([\s\S]*assessedAt:\s*assessment\.assessedAt/, "talent correction writes must reject stale concurrent decisions");
expect(talentPatchPath, talentPatch, /correctionReason[\s\S]*assessedById:\s*ctx\.actorId[\s\S]*assessedAt:\s*correctedAt/, "material corrections must persist rationale and refresh human assessor provenance");
expect(talentPatchPath, talentPatch, /previous=\$\{assessment\.performance\}\/\$\{assessment\.potential\}\/critical:\$\{assessment\.criticalTalent\}[\s\S]*next=\$\{nextPerformance\}\/\$\{nextPotential\}\/critical:\$\{nextCriticalTalent\}[\s\S]*reasonRecorded=\$\{Boolean\(decisionChanged && correctionReason\)\}/, "talent correction audit must capture decision shape without copying rationale text");
expect(talentPatchPath, talentPatch, /STALE_STATE/, "concurrent talent corrections must surface a bounded stale-state conflict");

const talentDataPath = "lib/talent-governance-data.ts";
const talentData = await source(talentDataPath);
expect(talentDataPath, talentData, /resolveEmploymentScope/, "talent governance reads must resolve relationship scope");
expect(talentDataPath, talentData, /employmentIdFilter\(scope\)/, "talent governance reads must filter authorized employments");
expect(talentDataPath, talentData, /userAccount\.findMany/, "talent governance must resolve assessor identity without hiding the human owner");
expect(talentDataPath, talentData, /correctionReason:\s*true/, "talent governance data must load persisted correction rationale");
expect(talentDataPath, talentData, /correctionReason:\s*row\.correctionReason/, "talent governance UI must receive correction rationale");

const talentConsolePath = "components/talent-governance-console.tsx";
const talentConsole = await source(talentConsolePath);
expect(talentConsolePath, talentConsole, /\/api\/talent\/assessments\/\$\{id\}/, "talent governance console must use the governed correction endpoint");
expect(talentConsolePath, talentConsole, /method:\s*"PATCH"/, "talent governance console must use explicit patch mutations");
expect(talentConsolePath, talentConsole, /criticalTalent/, "talent governance console must preserve explicit critical-talent designation");
expect(talentConsolePath, talentConsole, /Assessed by|Değerlendiren/, "talent governance console must expose assessor ownership");
expect(talentConsolePath, talentConsole, /expectedAssessedAt:\s*row\.assessedAt/, "talent correction UI must submit concurrency evidence");
expect(talentConsolePath, talentConsole, /name="correctionReason"[\s\S]*maxLength=\{2000\}/, "talent correction UI must mirror the bounded rationale contract");
expect(talentConsolePath, talentConsole, /row\.correctionReason/, "talent governance UI must surface the last material correction rationale");

const growthSchemaPath = "prisma/growth.prisma";
const growthSchema = await source(growthSchemaPath);
expect(growthSchemaPath, growthSchema, /model TalentAssessment[\s\S]*correctionReason\s+String\?/, "talent assessments must persist material correction rationale");
const talentMigrationPath = "prisma/migrations/20261012160000_talent_assessment_correction_reason/migration.sql";
const talentMigration = await source(talentMigrationPath);
expect(talentMigrationPath, talentMigration, /ALTER TABLE "TalentAssessment"[\s\S]*ADD COLUMN "correctionReason" TEXT/, "talent correction rationale must be delivered through a versioned migration");

const coursePath = "app/api/learning/courses/[id]/route.ts";
const course = await source(coursePath);
expect(coursePath, course, /can\(ctx,\s*"learning:write"\)/, "course catalog maintenance must require learning:write");
expect(coursePath, course, /validityMonths must be between 1 and 120 or blank/, "course validity must be bounded");
expect(coursePath, course, /learning-course\.deactivated/, "course catalog must support auditable deactivation");
expect(coursePath, course, /learning-course\.reactivated/, "course catalog must support auditable reactivation");

const skillPath = "app/api/learning/skills/[id]/route.ts";
const skill = await source(skillPath);
expect(skillPath, skill, /can\(ctx,\s*"learning:write"\)/, "skill catalog maintenance must require learning:write");
expect(skillPath, skill, /skill\.deactivated/, "skill catalog must support auditable deactivation");
expect(skillPath, skill, /skill\.reactivated/, "skill catalog must support auditable reactivation");

const employmentSkillPath = "app/api/learning/employment-skills/[id]/route.ts";
const employmentSkill = await source(employmentSkillPath);
expect(employmentSkillPath, employmentSkill, /can\(ctx,\s*"learning:write"\)/, "employee proficiency reassessment must require learning:write");
expect(employmentSkillPath, employmentSkill, /canActOnEmployment/, "employee proficiency reassessment must enforce relationship scope");
expect(employmentSkillPath, employmentSkill, /Object\.values\(SkillProficiency\)/, "employee proficiency reassessment must validate proficiency enums");
expect(employmentSkillPath, employmentSkill, /employee-skill\.reassessed/, "employee proficiency reassessment must emit explicit audit evidence");

const learningDataPath = "lib/learning-governance-data.ts";
const learningData = await source(learningDataPath);
expect(learningDataPath, learningData, /resolveEmploymentScope/, "learning governance reads must resolve relationship scope");
expect(learningDataPath, learningData, /employmentIdFilter\(scope\)/, "learning governance reads must filter employee-scoped assignments and skills");
expect(learningDataPath, learningData, /active:\s*"desc"/, "learning governance must preserve inactive catalog history after active records");

const learningConsolePath = "components/learning-governance-console.tsx";
const learningConsole = await source(learningConsolePath);
expect(learningConsolePath, learningConsole, /\/api\/learning\/courses\/\$\{course\.id\}/, "learning governance console must maintain course lifecycle through governed endpoints");
expect(learningConsolePath, learningConsole, /\/api\/learning\/skills\/\$\{skill\.id\}/, "learning governance console must maintain skill lifecycle through governed endpoints");
expect(learningConsolePath, learningConsole, /\/api\/learning\/employment-skills\/\$\{record\.id\}/, "learning governance console must reassess employee proficiency through governed endpoints");
expect(learningConsolePath, learningConsole, /Deactivate|Pasife al/, "learning catalog governance must expose non-destructive deactivation");
expect(learningConsolePath, learningConsole, /Reassess|Yeniden değerlendir/, "employee proficiency governance must expose explicit human reassessment");

if (failures.length) {
  console.error("Talent and learning governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated talent and learning governance contract: assessor ownership, relationship scope, non-destructive catalog lifecycle, bounded inputs and auditable proficiency reassessment are enforced.");
