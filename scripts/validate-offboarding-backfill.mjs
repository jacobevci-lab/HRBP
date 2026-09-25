import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /replacementRequired\s+Boolean\?/, "separation must retain the human replacement decision");
expect(schemaPath, schema, /replacementDecisionReason\s+String\?[\s\S]*replacementDecisionById\s+String\?[\s\S]*replacementDecisionAt\s+DateTime\?/, "replacement evidence must retain reason, actor and timestamp");
expect(schemaPath, schema, /replacementRequisitionId\s+String\?/, "separation must retain the recruiting handoff id");
expect(schemaPath, schema, /@@index\(\[tenantId, replacementRequisitionId\]\)/, "replacement handoffs must be tenant-indexed");

const routePath = "app/api/offboarding/processes/[id]/replacement/route.ts";
const route = await source(routePath);
expect(routePath, route, /mutationOriginAllowed/, "replacement decisions must enforce same-origin mutation protection");
expect(routePath, route, /can\(ctx,\s*"offboarding:write"\)/, "replacement decisions must require offboarding write authority");
expect(routePath, route, /required\s*&&\s*!can\(ctx,\s*"recruiting:write"\)/, "positive replacement decisions must additionally require recruiting write authority");
expect(routePath, route, /canActOnEmployment/, "replacement decisions must respect employment relationship scope");
expect(routePath, route, /reason\.length\s*<\s*10/, "replacement decisions must require a meaningful human rationale");
expect(routePath, route, /SeparationStatus\.CLOSED[\s\S]*SeparationStatus\.CANCELLED/, "terminal separations must reject replacement decisions");
expect(routePath, route, /POSITION_REQUIRED/, "backfill creation must require a position-backed employment");
expect(routePath, route, /status:\s*RequisitionStatus\.DRAFT[\s\S]*openings:\s*1/, "offboarding may create only one-opening draft recruiting demand");
expect(routePath, route, /replacementRequisitionId:\s*null/, "replacement handoff must be state-aware and prevent duplicate requisitions");
expect(routePath, route, /updatedAt:\s*process\.updatedAt/, "replacement handoff must use optimistic process state protection");
expect(routePath, route, /offboarding\.replacement-required[\s\S]*offboarding\.replacement-not-required/, "both replacement outcomes must append audit evidence");
expect(routePath, route, /REQUISITION_CREATED_FROM_OFFBOARDING/, "created backfill requisitions must append recruiting audit evidence");
expect(routePath, route, /OFFBOARDING_BACKFILL_DRAFT_CREATED[\s\S]*PlatformRole\.RECRUITER/, "a draft handoff must notify Recruiting transactionally");
expect(routePath, route, /TransactionIsolationLevel\.Serializable/, "replacement handoff must use serializable isolation");
expect(routePath, route, /P2034/, "replacement handoff must handle serialization conflicts");

const cancelPath = "app/api/offboarding/processes/[id]/cancel/route.ts";
const cancel = await source(cancelPath);
expect(cancelPath, cancel, /RequisitionStatus\.DRAFT[\s\S]*RequisitionStatus\.APPROVAL/, "uncommitted linked backfills must be eligible for automatic retirement");
expect(cancelPath, cancel, /RequisitionStatus\.OPEN[\s\S]*RequisitionStatus\.ON_HOLD[\s\S]*RequisitionStatus\.CLOSED/, "committed recruiting demand must block silent source cancellation");
expect(cancelPath, cancel, /can\(ctx,\s*"recruiting:write"\)/, "cross-domain cancellation must require recruiting authority when a live linked requisition exists");
expect(cancelPath, cancel, /REQUISITION_CANCELLED_FROM_OFFBOARDING/, "automatic linked-requisition retirement must be audited");
expect(cancelPath, cancel, /REPLACEMENT_COMMITTED/, "advanced recruiting work must explicitly block separation cancellation");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /replacementRequired:\s*boolean\s*\|\s*null/, "live offboarding rows must expose replacement state");
expect(dataPath, data, /replacementDecisionReason[\s\S]*replacementRequisitionId/, "live offboarding rows must expose replacement evidence and handoff id");
expect(dataPath, data, /replacementDecisionsPending[\s\S]*backfillDrafts/, "workspace data must expose replacement/backfill metrics");

const consolePath = "components/offboarding-replacement-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/replacement`/, "replacement UI must call the governed endpoint");
expect(consolePath, consoleSource, /Create backfill draft[\s\S]*No replacement/, "replacement UI must support both explicit human outcomes");
expect(consolePath, consoleSource, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "replacement UI must mirror decision-reason bounds");
expect(consolePath, consoleSource, /canRecruitingWrite/, "replacement UI must respect recruiting authority before draft creation");
expect(consolePath, consoleSource, /\/module\/recruiting/, "completed handoff must link to Recruiting ownership");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /OffboardingReplacementConsole/, "offboarding workspace must expose the connected replacement decision surface");
expect(workspacePath, workspace, /can\(ctx,"recruiting:write"\)/, "workspace must pass recruiting authority to the handoff surface");

const historyPath = "lib/offboarding-history-data.ts";
const history = await source(historyPath);
expect(historyPath, history, /replacementDecisionAt[\s\S]*Replacement approved and handed to Recruiting/, "terminal history must reconstruct the replacement decision");
expect(historyPath, history, /resourceType:\s*"Requisition"/, "audit-enabled terminal history must include linked requisition evidence");

const notificationPath = "lib/notification-display.ts";
const notification = await source(notificationPath);
expect(notificationPath, notification, /OFFBOARDING_BACKFILL_DRAFT_CREATED/, "backfill handoff must have a localized notification title");
expect(notificationPath, notification, /resourceType === "Requisition"[\s\S]*\/module\/recruiting/, "backfill notification must navigate into Recruiting");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /"offboarding-backfill:validate":\s*"node scripts\/validate-offboarding-backfill\.mjs"/, "package scripts must expose the backfill validator");
expect(packagePath, pkg, /offboarding-schedule:validate[\s\S]*offboarding-backfill:validate[\s\S]*maintenance:validate/, "prebuild must run the backfill validator");

if (failures.length) {
  console.error("Offboarding/recruiting backfill validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding/recruiting backfill validation passed.");
