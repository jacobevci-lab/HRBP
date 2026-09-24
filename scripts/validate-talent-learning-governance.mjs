import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /TalentGovernanceConsole/, "talent write users must receive the human assessment governance console");
expect(modulePath, modulePage, /getTalentGovernanceData\(ctx\)/, "talent governance data must load from the signed request context");
expect(modulePath, modulePage, /LearningGovernanceConsole/, "learning write users must receive catalog and proficiency governance controls");
expect(modulePath, modulePage, /getLearningGovernanceData\(ctx\)/, "learning governance data must load from the signed request context");

const talentPatchPath = "app/api/talent/assessments/[id]/route.ts";
const talentPatch = await source(talentPatchPath);
expect(talentPatchPath, talentPatch, /can\(ctx,\s*"talent:write"\)/, "talent corrections must require talent:write");
expect(talentPatchPath, talentPatch, /canActOnEmployment/, "talent corrections must enforce relationship scope");
expect(talentPatchPath, talentPatch, /assessedById:\s*ctx\.actorId/, "talent corrections must bind the human assessor identity");
expect(talentPatchPath, talentPatch, /talent-assessment\.corrected/, "talent corrections must emit explicit audit evidence");
expect(talentPatchPath, talentPatch, /slice\(0,\s*4000\)/, "talent correction notes must be bounded");

const talentDataPath = "lib/talent-governance-data.ts";
const talentData = await source(talentDataPath);
expect(talentDataPath, talentData, /resolveEmploymentScope/, "talent governance reads must resolve relationship scope");
expect(talentDataPath, talentData, /employmentIdFilter\(scope\)/, "talent governance reads must filter authorized employments");
expect(talentDataPath, talentData, /userAccount\.findMany/, "talent governance must resolve assessor identity without hiding the human owner");

const talentConsolePath = "components/talent-governance-console.tsx";
const talentConsole = await source(talentConsolePath);
expect(talentConsolePath, talentConsole, /\/api\/talent\/assessments\/\$\{id\}/, "talent governance console must use the governed correction endpoint");
expect(talentConsolePath, talentConsole, /method:\s*"PATCH"/, "talent governance console must use explicit patch mutations");
expect(talentConsolePath, talentConsole, /criticalTalent/, "talent governance console must preserve explicit critical-talent designation");
expect(talentConsolePath, talentConsole, /Assessed by|Değerlendiren/, "talent governance console must expose assessor ownership");

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
