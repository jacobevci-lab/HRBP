import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /workflows:approve/, "authorization must define a dedicated workflow approval capability");

const intakePath = "app/api/workflows/definitions/route.ts";
const intake = await source(intakePath);
expect(intakePath, intake, /mutationOriginAllowed\(request\)/, "workflow definition mutations must enforce origin checks");
expect(intakePath, intake, /MAX_STEPS = 50/, "workflow definition intake must bound step count");
expect(intakePath, intake, /stepKey values must be unique/, "workflow definition intake must reject duplicate step keys");
expect(intakePath, intake, /Object\.values\(PlatformRole\)/, "workflow assignee roles must be validated against platform roles");
expect(intakePath, intake, /MAX_SLA_MINUTES = 43_200/, "workflow step SLA must be bounded");
expect(intakePath, intake, /version must be an integer between 1 and 1000/, "workflow definition version must be bounded");
expect(intakePath, intake, /PrismaClientKnownRequestError[\s\S]*P2002/, "duplicate workflow key/version creation must return a governed conflict");
expect(intakePath, intake, /This workflow key and version already exist/, "duplicate workflow versions must return an explicit conflict message");

const routePath = "app/api/workflows/definitions/[id]/lifecycle/route.ts";
const route = await source(routePath);
expect(routePath, route, /can\(ctx,\s*"workflows:approve"\)/, "workflow definition lifecycle must require approval authority");
expect(routePath, route, /current\.createdById === ctx\.actorId/, "definition creators must not activate their own definition");
expect(routePath, route, /WorkflowDefinitionStatus\.ACTIVE/, "definition lifecycle must support activation");
expect(routePath, route, /WorkflowDefinitionStatus\.PAUSED/, "definition lifecycle must support pause");
expect(routePath, route, /WorkflowDefinitionStatus\.RETIRED/, "definition lifecycle must support retirement");
expect(routePath, route, /activatableStatuses\.has\(current\.status\)/, "activation state guard must be type-safe and bounded");
expect(routePath, route, /retirableStatuses\.has\(current\.status\)/, "retirement state guard must be type-safe and bounded");
expect(routePath, route, /Independent workflow definition activation/, "activation audit evidence must preserve four-eyes purpose");
expect(routePath, route, /activeSibling[\s\S]*WorkflowDefinitionStatus\.ACTIVE/, "activation must reject a second active version for the same workflow key");
expect(routePath, route, /ACTIVE_VERSION/, "active-version conflicts must return a governed conflict");
reject(routePath, route, /workflowInstance\.(?:update|updateMany|delete|deleteMany)/, "definition lifecycle transitions must not silently mutate running workflow instances");


const editorRoutePath = "app/api/workflows/definitions/[id]/route.ts";
const editorRoute = await source(editorRoutePath);
expect(editorRoutePath, editorRoute, /mutationOriginAllowed\(request\)/, "workflow draft editing must enforce origin checks");
expect(editorRoutePath, editorRoute, /can\(ctx,\s*"workflows:write"\)/, "workflow draft editing must require workflow write authority");
expect(editorRoutePath, editorRoute, /current\.status !== WorkflowDefinitionStatus\.DRAFT/, "only draft definitions may be edited");
expect(editorRoutePath, editorRoute, /updatedAt:\s*current\.updatedAt/, "draft editing must use optimistic concurrency");
expect(editorRoutePath, editorRoute, /workflowStepDefinition\.deleteMany[\s\S]*workflowStepDefinition\.createMany/, "draft step replacement must occur inside the governed transaction");
expect(editorRoutePath, editorRoute, /TransactionIsolationLevel\.Serializable/, "workflow draft editing must be serializable");
expect(editorRoutePath, editorRoute, /MAX_STEPS = 50/, "workflow draft editing must preserve the step bound");
expect(editorRoutePath, editorRoute, /Object\.values\(PlatformRole\)/, "workflow draft editing must validate assignee roles");
expect(editorRoutePath, editorRoute, /workflow-definition\.draft-updated/, "workflow draft edits must be audited");
reject(editorRoutePath, editorRoute, /WorkflowDefinitionStatus\.ACTIVE[\s\S]*data:\s*\{\s*name/, "active definitions must not be edited in place");

const editorPath = "components/workflow-definition-editor.tsx";
const editor = await source(editorPath);
expect(editorPath, editor, /\/api\/workflows\/definitions/, "workflow editor must use the governed definition API");
expect(editorPath, editor, /Add step|Adım ekle/, "workflow editor must expose step creation");
expect(editorPath, editor, /moveStep/, "workflow editor must support explicit step ordering");
expect(editorPath, editor, /removeStep/, "workflow editor must support bounded step removal");
expect(editorPath, editor, /assigneeRole/, "workflow editor must support role-bound steps");
expect(editorPath, editor, /slaMinutes/, "workflow editor must expose bounded SLA authoring");
expect(editorPath, editor, /Only DRAFT definitions are editable|Yalnızca DRAFT/, "workflow editor must disclose draft-only mutation semantics");
expect(editorPath, editor, /cloneDefinition/, "workflow editor must support creating a new governed version from immutable versions");
expect(editorPath, editor, /cloneSources[\s\S]*status !== "DRAFT"/, "workflow version cloning must source only immutable non-draft definitions");
expect(editorPath, editor, /Math\.max\([\s\S]*definition\.version[\s\S]*highestVersion \+ 1/, "workflow clone must prepare the next tenant-visible version number");
expect(editorPath, editor, /highestVersion >= 1000/, "workflow version cloning must enforce the maximum supported version ceiling");
expect(editorPath, editor, /setSelectedId\(""\)[\s\S]*setKey\(definition\.key\)/, "cloning must create a new draft rather than editing the immutable source");
expect(editorPath, editor, /Create next version from|Yeni sürümü şundan oluştur/, "workflow editor must expose version cloning in the UI");

const continuityPath = "lib/workflow-definition-action-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getEngagementLifecycleActionCenterData\(ctx\)/, "Workflow Definition continuity must extend the current Engagement continuity chain");
expect(continuityPath, continuity, /can\(ctx,\s*"workflows:approve"\)/, "definition approval attention must require approval authority");
expect(continuityPath, continuity, /status:\s*WorkflowDefinitionStatus\.DRAFT/, "only draft definitions may enter activation attention");
expect(continuityPath, continuity, /createdById:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "creator-owned definitions must be excluded from self-approval attention");
expect(continuityPath, continuity, /\/module\/workflows\?definition=/, "definition approval attention must deep-link to exact governed focus");
expect(continuityPath, continuity, /kind:\s*"workflow"/, "definition approvals must reuse the existing Workflow source");
expect(continuityPath, continuity, /workflow:\s*items\.filter\(\(item\) => item\.kind === "workflow"\)\.length/, "Workflow summary must include both task and definition attention");
reject(continuityPath, continuity, /configuration|steps:|assigneeRole|slaMinutes/, "central definition attention must not load workflow configuration or step detail");

const liveDataPath = "lib/employee-services-live-data.ts";
const liveData = await source(liveDataPath);
expect(liveDataPath, liveData, /createdById:\s*definition\.createdById/, "live workflow register must expose creator provenance for governance controls");
expect(liveDataPath, liveData, /rawStatus:\s*definition\.status/, "live workflow register must retain exact lifecycle state");

const livePath = "components/employee-services-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /data-workflow-definition-id/, "workflow definition rows must expose exact focus anchors");
expect(livePath, live, /focusVisible/, "workflow definition focus must fail closed when unavailable");
expect(livePath, live, /WorkflowDefinitionActions/, "definition lifecycle actions must remain in the owning Workflows workspace");
expect(livePath, live, /WorkflowDefinitionEditor/, "workflow authoring must be mounted in the governed Workflows workspace");
expect(livePath, live, /can\(ctx,"workflows:write"\)/, "workflow editor visibility must require workflow write authority");
expect(livePath, live, /GovernedFocusScroller/, "exact definition focus must scroll into view");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.definition/, "Workflows deep links must accept an exact definition focus");
expect(modulePath, modulePage, /workflowLifecycleQuery/, "definition focus must route only through the Workflows module query");

const apiPath = "app/api/action-center/route.ts";
const api = await source(apiPath);
expect(apiPath, api, /workflow-definition-action-continuity/, "Action Center API must use the workflow-definition top-level continuity wrapper");
expect(apiPath, api, /cache-control[\s\S]*no-store/, "actor-specific Action Center output must remain non-cacheable");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getWorkflowDefinitionLifecycleActionCenterData/, "Dashboard must use the current top-level workflow definition continuity source");
reject(dashboardPath, dashboard, /configuration|stepKey|assigneeRole|slaMinutes|data\.items|items:\s*data/, "Dashboard must remain aggregate-only");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /getWorkflowDefinitionLifecycleActionCenterData/, "Analytics must use the current top-level workflow definition continuity source");
expect(analyticsPath, analytics, /workflow:\s*source\.summary\.workflow/, "Analytics must project only aggregate Workflow attention");
expect(analyticsPath, analytics, /aggregateOnly:\s*true/, "Analytics lifecycle continuity must remain aggregate-only");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /workflow-definition-governance:validate/, "workflow definition governance validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*workflow-definition-governance:validate/, "workflow definition governance validation must run before production builds");

if (failures.length) {
  console.error("Workflow definition governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Workflow definition governance validation passed.");
