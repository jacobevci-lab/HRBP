import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/hr-service-lifecycle.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /model HRServiceStatusTransition/, "status transitions must have first-class evidence");
expect(schemaPath, schema, /fromStatus\s+ServiceRequestStatus[\s\S]*toStatus\s+ServiceRequestStatus[\s\S]*actorId\s+String[\s\S]*occurredAt\s+DateTime/, "transition evidence must retain before/after state, actor and time");
expect(schemaPath, schema, /model HRServiceSlaPause/, "SLA pauses must have first-class evidence");
expect(schemaPath, schema, /resumedById\s+String\?[\s\S]*resumedAt\s+DateTime\?[\s\S]*remainingMinutes\s+Int\?/, "SLA pause evidence must retain remaining time and resume provenance");

const statusPath = "app/api/hr-service/requests/[id]/status/route.ts";
const status = await source(statusPath);
expect(statusPath, status, /mutationOriginAllowed/, "status mutation must enforce same-origin protection");
expect(statusPath, status, /can\(ctx,\s*"hr-service:write"\)/, "status mutation must require service write capability");
expect(statusPath, status, /reason\.length\s*<\s*10/, "governed terminal/wait/reopen transitions must require a meaningful reason");
expect(statusPath, status, /hRServiceStatusTransition\.create/, "status changes must create immutable transition evidence");
expect(statusPath, status, /hRServiceSlaPause\.create[\s\S]*slaDueAt\s*=\s*null/, "waiting states must pause the SLA clock");
expect(statusPath, status, /hRServiceSlaPause\.findFirst[\s\S]*resumedAt:\s*null[\s\S]*remainingMinutes/, "resuming work must restore recorded SLA time");
expect(statusPath, status, /current\.status\s*===\s*ServiceRequestStatus\.RESOLVED[\s\S]*ServiceRequestStatus\.IN_PROGRESS/, "resolved requests must use an explicit governed reopen path");
expect(statusPath, status, /updatedAt:\s*current\.updatedAt/, "status updates must use optimistic concurrency protection");
expect(statusPath, status, /TransactionIsolationLevel\.Serializable/, "status transitions must use serializable isolation");
expect(statusPath, status, /HR_SERVICE_STATUS_CHANGED/, "requestors must receive status-change notification intent");
expect(statusPath, status, /HR_SERVICE_ASSIGNED/, "new assignees must receive assignment notification intent");
expect(statusPath, status, /HR_SERVICE_ESCALATED[\s\S]*readAt:\s*now/, "stale escalation notifications must retire when the lifecycle resets escalation");

const commentsPath = "app/api/hr-service/requests/[id]/comments/route.ts";
const comments = await source(commentsPath);
expect(commentsPath, comments, /readJsonObject/, "comment creation must use safe JSON object parsing");
expect(commentsPath, comments, /asText\(body\.body,\s*4000\)/, "comment bodies must be bounded");
expect(commentsPath, comments, /commentTerminalStatuses[\s\S]*CLOSED[\s\S]*CANCELLED/, "terminal requests must reject new comments");
expect(commentsPath, comments, /firstResponseAt:\s*comment\.createdAt/, "first response must be established by a requestor-visible staff reply");
expect(commentsPath, comments, /PRIVATE_NOTE[\s\S]*hr-service\.private-note-added/, "private handling notes must be explicit audit evidence");
expect(commentsPath, comments, /HR_SERVICE_REQUESTOR_REPLIED/, "requestor replies must notify service operations");
expect(commentsPath, comments, /HR_SERVICE_STAFF_REPLIED/, "requestor-visible staff replies must notify the requester");

const intakePath = "app/api/hr-service/requests/route.ts";
const intake = await source(intakePath);
expect(intakePath, intake, /asText\(body\.category,\s*80\)/, "request category must be bounded");
expect(intakePath, intake, /asText\(body\.title,\s*200\)/, "request title must be bounded");
expect(intakePath, intake, /asText\(body\.description,\s*4000\)/, "request description must be bounded");
expect(intakePath, intake, /subjectEmploymentId\s*=\s*selfService\s*\?\s*ctx\.employmentId/, "self-service request identity must come from trusted employment context");
expect(intakePath, intake, /HR_SERVICE_REQUEST_CREATED/, "new requests must create durable notification intent");
expect(intakePath, intake, /ServiceQueueRole|role:\s*"OWNER"/, "queued intake should notify configured queue ownership");

const liveDataPath = "lib/hr-service-lifecycle-live-data.ts";
const liveData = await source(liveDataPath);
expect(liveDataPath, liveData, /hrServiceRequestWhere/, "lifecycle evidence must stay inside service scope");
expect(liveDataPath, liveData, /hRServiceStatusTransition\.findMany[\s\S]*take:\s*500/, "transition evidence query must be bounded");
expect(liveDataPath, liveData, /hRServiceSlaPause\.findMany[\s\S]*resumedAt:\s*null/, "workspace must surface active SLA pause evidence");
expect(liveDataPath, liveData, /P2021[\s\S]*P2022/, "new evidence tables must fail soft during staged schema rollout");

const actionPath = "components/hr-service-lifecycle-actions.tsx";
const actions = await source(actionPath);
expect(actionPath, actions, /\/api\/hr-service\/requests\/\$\{encodeURIComponent\(requestId\)\}\/status/, "lifecycle actions must call the governed status endpoint");
expect(actionPath, actions, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "transition reason UI must mirror server bounds");
expect(actionPath, actions, /PRIVATE_NOTE/, "service staff must be able to record private handling notes deliberately");

const formPath = "components/hr-service-request-form.tsx";
const form = await source(formPath);
expect(formPath, form, /maxLength=\{80\}[\s\S]*maxLength=\{200\}[\s\S]*maxLength=\{4000\}/, "intake UI must mirror bounded request fields");
expect(formPath, form, /fetch\("\/api\/hr-service\/requests"/, "intake UI must use the governed request endpoint");

const panelPath = "components/hr-service-lifecycle-panel.tsx";
const panel = await source(panelPath);
expect(panelPath, panel, /HRServiceLifecycleActions/, "live service workspace must expose governed lifecycle actions");
expect(panelPath, panel, /HRServiceRequestForm/, "live service workspace must expose governed intake");
expect(panelPath, panel, /schemaReady/, "lifecycle panel must fail soft during schema rollout");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /slug\s*===\s*"hr-service"[\s\S]*<HRServiceLifecyclePanel/, "HR Service module must mount lifecycle governance");

const notificationPath = "lib/notification-display.ts";
const notification = await source(notificationPath);
expect(notificationPath, notification, /HR_SERVICE_REQUEST_CREATED[\s\S]*HR_SERVICE_STATUS_CHANGED[\s\S]*HR_SERVICE_ASSIGNED/, "HR service lifecycle notifications must be localized");
expect(notificationPath, notification, /resourceType\s*===\s*"HRServiceRequest"/, "HR service notifications must deep-link to the service workspace");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /hr-service-lifecycle:validate/, "HR service lifecycle validator must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*hr-service-lifecycle:validate/, "HR service lifecycle validation must run before production builds");

if (failures.length) {
  console.error("HR Service lifecycle governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("HR Service lifecycle governance validation passed.");
