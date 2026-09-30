import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const continuityPath = "lib/privacy-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /privacyRiskAssessment\.findMany/, "Privacy attention must include owned assurance assessments");
expect(continuityPath, continuity, /ownerId:\s*ctx\.actorId/, "assessment attention must remain owner-bound");
expect(continuityPath, continuity, /completedAt:\s*null/, "completed privacy assessments must not remain in active attention");
expect(continuityPath, continuity, /status:\s*\{\s*notIn:\s*\["COMPLETED",\s*"CLOSED"\]/, "completed or closed assessment states must be excluded from attention");
expect(continuityPath, continuity, /dataTransferRegister\.findMany/, "Privacy attention must include active transfer impact reviews");
expect(continuityPath, continuity, /transferImpactDueAt:\s*\{\s*not:\s*null,\s*lte:\s*assuranceHorizon\s*\}/, "transfer attention must require a TIA due date inside the assurance horizon");
expect(continuityPath, continuity, /30 \* 24 \* 60 \* 60 \* 1000/, "TIA attention must be bounded to the next 30 days or overdue");
expect(continuityPath, continuity, /\/module\/privacy\?assessment=/, "assessment attention must deep-link to exact privacy assessment focus");
expect(continuityPath, continuity, /\/module\/privacy\?transfer=/, "transfer attention must deep-link to exact transfer focus");
reject(continuityPath, continuity, /findings|dataCategories|specialCategories|subjectPersonId/, "central privacy assurance attention must not load sensitive narrative or data-category detail");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /assessments:\s*assessments\.slice/, "Privacy live data must expose bounded assessment rows");
expect(dataPath, data, /tiaDueAtIso/, "Privacy live data must expose transfer due-date focus metadata");
reject(dataPath, data, /findings:\s*assessment\.findings/, "Privacy live workspace must not project assessment findings by default");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.assessment/, "Privacy routing must accept exact assessment focus");
expect(modulePath, modulePage, /search\.transfer/, "Privacy routing must accept exact transfer focus");

const livePath = "components/governance-planning-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /privacyFocusType/, "Privacy workspace must distinguish DSR, assessment and transfer focus types");
expect(livePath, live, /data-privacy-assessment-id/, "assessment rows must provide exact focus anchors");
expect(livePath, live, /data-privacy-transfer-id/, "transfer rows must provide exact focus anchors");
expect(livePath, live, /GovernedFocusScroller/, "privacy assurance focus must scroll to the exact authorized record");
expect(livePath, live, /DPIA & privacy risk assessments/, "Privacy workspace must expose the assurance assessment register");
expect(livePath, live, /Transfer impact review register/, "Privacy workspace must expose the TIA register");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /privacy-assurance:validate/, "Privacy assurance validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*privacy-assurance:validate/, "Privacy assurance validation must run before production builds");

if (failures.length) {
  console.error("Privacy assurance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Privacy assurance validation passed.");
