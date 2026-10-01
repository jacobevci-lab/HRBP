import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const createPath = "app/api/workforce-planning/scenarios/[id]/lines/route.ts";
const create = await source(createPath);
expect(createPath, create, /mutationOriginAllowed\(request\)/, "plan line creation must enforce origin checks");
expect(createPath, create, /can\(ctx,\s*"workforce-plan:write"\)/, "plan line creation must require workforce-plan write authority");
expect(createPath, create, /scenario\.ownerId !== ctx\.actorId/, "only the scenario owner may create draft plan lines");
expect(createPath, create, /scenario\.status !== WorkforceScenarioStatus\.DRAFT/, "plan line creation must be immutable after DRAFT");
expect(createPath, create, /resolveEmploymentScope\(tx, ctx\)/, "plan line creation must reuse relationship scope");
expect(createPath, create, /organizationUnit\.findFirst[\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*validTo:\s*null/, "org units must be tenant-bound and current");
expect(createPath, create, /position\.findFirst[\s\S]*tenantId:\s*ctx\.tenantId[\s\S]*validTo:\s*null/, "positions must be tenant-bound and current");
expect(createPath, create, /position\.orgUnitId !== orgUnitId/, "positions must belong to the selected organization unit");
expect(createPath, create, /DataClassification\.CONFIDENTIAL/, "plan line mutations must be confidential audit evidence");
expect(createPath, create, /skillsRequired/, "plan lines must support bounded skill demand signals");

const editPath = "app/api/workforce-planning/scenarios/[id]/lines/[lineId]/route.ts";
const edit = await source(editPath);
expect(editPath, edit, /export async function PATCH/, "plan lines must support governed updates");
expect(editPath, edit, /export async function DELETE/, "plan lines must support governed deletion");
expect(editPath, edit, /loadOwnedDraftLine/, "update/delete must load an owned draft line");
expect(editPath, edit, /scenario\.status !== WorkforceScenarioStatus\.DRAFT/, "update/delete must preserve post-DRAFT immutability");
expect(editPath, edit, /ensureScope\(tx, ctx/, "update/delete must revalidate relationship scope");
expect(editPath, edit, /workforce-plan-line\.updated/, "line updates must be audited");
expect(editPath, edit, /workforce-plan-line\.deleted/, "line deletions must be audited");

const reviewPath = "app/api/workforce-planning/scenarios/[id]/review/route.ts";
const review = await source(reviewPath);
expect(reviewPath, review, /current\.ownerId !== ctx\.actorId/, "only the scenario owner may submit or lock a plan");
expect(reviewPath, review, /workforcePlanLine\.count/, "scenario submission must require at least one plan line");
expect(reviewPath, review, /throw new Error\("EMPTY"\)/, "empty workforce scenarios must fail closed before review");

const optionsPath = "app/api/workforce-planning/options/route.ts";
const options = await source(optionsPath);
expect(optionsPath, options, /can\(ctx,\s*"workforce-plan:read"\)/, "planning options must require workforce plan read authority");
expect(optionsPath, options, /resolveEmploymentScope\(db, ctx\)/, "planning options must be relationship scoped");
expect(optionsPath, options, /organizationUnit\.findMany/, "planning options must expose governed org choices");
expect(optionsPath, options, /position\.findMany/, "planning options must expose governed position choices");
reject(optionsPath, options, /personId|displayName|email/, "planning options must not expose employee identity");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /ownerId:\s*ctx\.actorId[\s\S]*lines:\s*\{\s*some:\s*scopedLineWhere/, "owned empty draft scenarios must remain visible without widening scoped line detail");
expect(dataPath, data, /lines:\s*scenario\.lines\.map/, "owning Workforce Planning workspace must receive line detail");
expect(dataPath, data, /demandDriver:\s*line\.demandDriver/, "owning workspace must expose demand drivers");
expect(dataPath, data, /skillsRequired:/, "owning workspace must expose requested skills");

const uiPath = "components/workforce-plan-line-manager.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/api\/workforce-planning\/options/, "line editor must use governed planning options");
expect(uiPath, ui, /method:\s*draft\.lineId \? "PATCH" : "POST"/, "line editor must support create and edit");
expect(uiPath, ui, /method:\s*"DELETE"/, "line editor must support delete");
expect(uiPath, ui, /ownerId === actorId && status === "DRAFT"/, "line editing UI must remain owner-bound and DRAFT-only");
expect(uiPath, ui, /hrbp:lifecycle-actions-changed/, "line mutations must invalidate lifecycle attention");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /WorkforcePlanLineManager/, "line management must be mounted in the governed Workforce Planning workspace");
expect(workspacePath, workspace, /lines=\{row\.lines\}/, "scenario rows must pass only owning-domain line details to the editor");

const continuityPath = "lib/workforce-planning-action-center-continuity.ts";
const continuity = await source(continuityPath);
reject(continuityPath, continuity, /avgAnnualCost|currentFte|plannedFte|skillsRequired|demandDriver|roleLabel/, "central Action Center must not project plan line details");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /workforce-planning-lines:validate/, "workforce plan line validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*workforce-planning-lines:validate/, "workforce plan line validation must run before production builds");

if (failures.length) {
  console.error("Workforce planning line validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Workforce planning line validation passed.");
