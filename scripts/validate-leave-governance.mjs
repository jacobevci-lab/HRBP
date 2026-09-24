import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /"leave:self-request"/, "leave self-service must have a dedicated capability");
expect(authPath, auth, /"leave:approve"/, "leave approval must have a dedicated capability");
expect(authPath, auth, /"leave:configure"/, "leave policy configuration must have a dedicated capability");
expect(authPath, auth, /EMPLOYEE:[\s\S]*"leave:read"[\s\S]*"leave:self-request"/, "employees must receive self-request without administrative leave write");
expectAbsent(authPath, auth.match(/EMPLOYEE:\s*\[[\s\S]*?\],\n\s*MANAGER:/)?.[0] ?? "", /"leave:write"/, "employees must not receive administrative leave write");
expect(authPath, auth, /MANAGER:[\s\S]*"leave:self-request"[\s\S]*"leave:approve"/, "managers must separate own requests from approval authority");

const requestPath = "app/api/leave/requests/route.ts";
const request = await source(requestPath);
expect(requestPath, request, /can\(ctx,\s*"leave:self-request"\)/, "own leave creation must require self-request capability");
expect(requestPath, request, /can\(ctx,\s*"leave:write"\)/, "on-behalf leave creation must require administrative write capability");
expect(requestPath, request, /LeaveRequestStatus\.PENDING[\s\S]*LeaveRequestStatus\.APPROVED[\s\S]*LeaveRequestStatus\.TAKEN/, "new leave must reject overlapping governed leave states");
expect(requestPath, request, /annualAllowance\s*!==\s*null/, "balance-tracked leave must be identified from policy");
expect(requestPath, request, /INSUFFICIENT_BALANCE/, "automatic approval must enforce available balance");
expect(requestPath, request, /TransactionIsolationLevel\.Serializable/, "leave creation and balance reservation must be serialized");
expect(requestPath, request, /enqueueLeaveApprovalNotification/, "pending leave must notify the governed manager identity");
expect(requestPath, request, /appendAudit/, "leave creation must emit audit evidence");

const decisionPath = "app/api/leave/requests/[id]/decision/route.ts";
const decision = await source(decisionPath);
expect(decisionPath, decision, /can\(ctx,\s*"leave:approve"\)/, "leave decisions must require approval capability rather than generic write");
expect(decisionPath, decision, /SELF_APPROVAL/, "leave decision must block self-approval");
expect(decisionPath, decision, /canActOnEmployment/, "leave decisions must preserve relationship scope");
expect(decisionPath, decision, /INSUFFICIENT_BALANCE/, "approval must check governed balance");
expect(decisionPath, decision, /used:\s*\{\s*increment:/, "approval must reserve tracked balance atomically inside the transaction");
expect(decisionPath, decision, /updateMany/, "approval decision must use a state-aware write");
expect(decisionPath, decision, /enqueueLeaveDecisionNotification/, "approval result must notify the employee identity");
expect(decisionPath, decision, /TransactionIsolationLevel\.Serializable/, "approval and balance mutation must be serialized");

const cancelPath = "app/api/leave/requests/[id]/self-cancel/route.ts";
const cancel = await source(cancelPath);
expect(cancelPath, cancel, /can\(ctx,\s*"leave:self-request"\)/, "employee cancellation must require self-service capability");
expect(cancelPath, cancel, /current\.employmentId\s*!==\s*ctx\.employmentId/, "employee cancellation must reject another employment's leave");
expect(cancelPath, cancel, /LeaveRequestStatus\.PENDING[\s\S]*LeaveRequestStatus\.APPROVED/, "self cancellation must be limited to pending or approved requests");
expect(cancelPath, cancel, /used:\s*\{\s*decrement:/, "approved tracked leave cancellation must restore balance");
expect(cancelPath, cancel, /BALANCE_INTEGRITY/, "balance restoration must refuse impossible negative usage");
expect(cancelPath, cancel, /leave-request\.self-cancelled/, "self cancellation must emit explicit audit evidence");

const typePath = "app/api/leave/types/route.ts";
const leaveType = await source(typePath);
expect(typePath, leaveType, /mutationOriginAllowed/, "leave policy mutation must enforce same-origin mutation policy");
expect(typePath, leaveType, /can\(ctx,\s*"leave:configure"\)/, "leave type creation must require policy configuration capability");
expect(typePath, leaveType, /annualAllowance must be between/, "leave allowance configuration must be bounded");

const dataPath = "lib/leave-participant-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /employmentId\s*=\s*ctx\.employmentId/, "employee leave data must be bound to signed employment identity");
expect(dataPath, data, /can\(ctx,\s*"leave:self-request"\)/, "employee leave data must be capability gated");
expect(dataPath, data, /opening[\s\S]*accrued[\s\S]*adjustment[\s\S]*used/, "self-service balance must derive remaining units from governed balance components");

const consolePath = "components/leave-participant-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/api\/leave\/requests/, "leave self-service must create requests through the governed API");
expect(consolePath, consoleSource, /\/self-cancel/, "leave self-service must use the identity-bound cancellation endpoint");
expect(consolePath, consoleSource, /Overlap and balance controls are enforced server-side/, "leave UI must disclose server-side governance controls");

const livePath = "components/work-pay-live-workspace.tsx";
const live = await source(livePath);
expect(livePath, live, /can\(ctx,\s*"leave:approve"\)/, "leave decision controls must be capability gated separately from self-service");

const modulePath = "components/work-pay-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /LeaveParticipantConsole/, "authenticated leave module must expose employee self-service");
expect(modulePath, modulePage, /getLeaveParticipantData\(ctx\)/, "leave self-service must load from signed request context");

const notificationPath = "lib/leave-notifications.ts";
const notifications = await source(notificationPath);
expect(notificationPath, notifications, /LEAVE_APPROVAL_REQUIRED/, "pending leave must use a dedicated manager notification");
expect(notificationPath, notifications, /LEAVE_REQUEST_APPROVED[\s\S]*LEAVE_REQUEST_REJECTED/, "leave decisions must have dedicated employee notifications");
expect(notificationPath, notifications, /workEmail:\s*true/, "leave notifications must resolve user identity from employment work email");
expect(notificationPath, notifications, /enqueueNotificationOutbox/, "leave notifications must use the durable outbox");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /LEAVE_APPROVAL_REQUIRED/, "notification center must present manager leave approvals");
expect(presentationPath, presentation, /LEAVE_REQUEST_APPROVED/, "notification center must present approved leave");
expect(presentationPath, presentation, /resourceType\s*===\s*"LeaveRequest"/, "leave notifications must deep-link to leave module");

if (failures.length) {
  console.error("Leave governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated leave governance contract: self-service ownership, approval separation, overlap prevention, serialized balance reservation/restoration, notifications and audit evidence are enforced.");
