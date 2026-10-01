import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const routePath = "app/api/policies/[id]/assignments/route.ts";
const route = await source(routePath);
expect(routePath, route, /mutationOriginAllowed\(request\)/, "policy assignment mutation must enforce origin checks");
expect(routePath, route, /can\(ctx,\s*"policies:write"\)/, "policy assignment must require policies write authority");
expect(routePath, route, /PolicyStatus\.PUBLISHED/, "only published policies may be assigned");
expect(routePath, route, /resolveEmploymentScope\(tx, ctx\)/, "policy assignment must reuse employment relationship scope");
expect(routePath, route, /canActOnEmployment\(scope, employmentId\)/, "each assignment target must stay inside authorized scope");
expect(routePath, route, /MAX_ASSIGNMENTS = 500/, "policy assignment batch size must be bounded");
expect(routePath, route, /dueAt must be in the future/, "policy assignment due dates must not be stale at creation");
expect(routePath, route, /const created = await tx\.policyAssignment\.createMany/, "policy assignment must use duplicate-safe batch creation");
expect(routePath, route, /assigned:\s*created\.count/, "policy assignment must report actual inserted count");
expect(routePath, route, /skippedExisting:\s*ids\.length - created\.count/, "policy assignment must report skipped existing assignments");

const optionsPath = "app/api/policies/[id]/assignment-options/route.ts";
const options = await source(optionsPath);
expect(optionsPath, options, /can\(ctx,\s*"policies:write"\)/, "assignment options must require policy write authority");
expect(optionsPath, options, /PolicyStatus\.PUBLISHED/, "assignment options must be available only for published policies");
expect(optionsPath, options, /resolveEmploymentScope\(db, ctx\)/, "assignment options must remain relationship scoped");
expect(optionsPath, options, /employmentPrimaryKeyFilter\(scope\)/, "employment options must reuse the governed employment scope filter");
expect(optionsPath, options, /status:\s*\{\s*not:\s*EmploymentStatus\.TERMINATED/, "terminated employments must not be assignment targets");
expect(optionsPath, options, /take:\s*500/, "assignment option queries must remain bounded");
expect(optionsPath, options, /policyAssignment\.findMany/, "existing assignments must be loaded separately without inventing an employment relation");
reject(optionsPath, options, /workEmail|personalEmail|dateOfBirth|nationalId|bank/, "assignment options must not expose sensitive employee fields");

const uiPath = "components/policy-assignment-manager.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /assignment-options/, "policy assignment UI must use the governed scoped options endpoint");
expect(uiPath, ui, /\/assignments/, "policy assignment UI must call the owning policy assignment endpoint");
expect(uiPath, ui, /Select visible/, "policy assignment UI must support bounded bulk selection");
expect(uiPath, ui, /employment\.assigned/, "existing assignments must be non-selectable");
expect(uiPath, ui, /hrbp:lifecycle-actions-changed/, "successful assignment must invalidate lifecycle attention");
expect(uiPath, ui, /hrbp:notifications-changed/, "successful assignment must refresh notification state");

const workspacePath = "components/employee-services-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /PolicyAssignmentManager/, "policy assignment manager must be mounted in the governed Policy workspace");
expect(workspacePath, workspace, /row\.rawStatus==="PUBLISHED"/, "assignment UI must render only for published policies");

const continuityPath = "lib/policy-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /PolicyAssignmentStatus\.PENDING[\s\S]*PolicyAssignmentStatus\.OVERDUE/, "new assignments must continue through Policy Action Center acknowledgement attention");
reject(continuityPath, continuity, /givenName|familyName|employeeNumber|organization|position/, "central Policy attention must not receive assignment target identity");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /policy-assignment-ux:validate/, "policy assignment validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*policy-assignment-ux:validate/, "policy assignment validation must run before production builds");

if (failures.length) {
  console.error("Policy assignment UX validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Policy assignment UX validation passed.");
