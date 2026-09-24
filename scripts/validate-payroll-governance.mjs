import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const authPath = "lib/authorization.ts";
const auth = await source(authPath);
expect(authPath, auth, /"payroll:prepare"/, "payroll preparation must have a dedicated capability");
expect(authPath, auth, /"payroll:approve"/, "payroll approval must have a dedicated capability");
expect(authPath, auth, /"payroll:pay"/, "payroll payment must have a dedicated capability");
expect(authPath, auth, /"payroll:configure"/, "payroll configuration must have a dedicated capability");
expect(authPath, auth, /PAYROLL_ADMIN:[\s\S]*"payroll:prepare"[\s\S]*"payroll:approve"[\s\S]*"payroll:pay"[\s\S]*"payroll:configure"/, "payroll administrators must receive the separated payroll capabilities");
const tenantAdminGrant = auth.match(/TENANT_ADMIN:\s*\[[\s\S]*?\]\n\};/)?.[0] ?? "";
expectAbsent(authPath, tenantAdminGrant, /"payroll:approve"|"payroll:pay"/, "broad tenant administration must not imply payroll approval or payment authority");

const helperPath = "lib/payroll-governance.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /calculatePayrollLedger/, "payroll lines must produce deterministic ledger totals");
expect(helperPath, helper, /TimeEntryStatus\.LOCKED/, "payroll readiness must require time inputs to be payroll-locked");
expect(helperPath, helper, /LeaveRequestStatus\.DRAFT[\s\S]*LeaveRequestStatus\.PENDING/, "payroll readiness must detect undecided leave inputs");
expect(helperPath, helper, /CompensationChangeStatus\.DRAFT[\s\S]*CompensationChangeStatus\.APPROVAL[\s\S]*CompensationChangeStatus\.APPROVED/, "payroll readiness must detect unapplied compensation changes");
expect(helperPath, helper, /createHash\("sha256"\)/, "locked payroll inputs must have a deterministic fingerprint");
expect(helperPath, helper, /payroll-run\.inputs-locked/, "fingerprint verification must use immutable audit evidence");

const resultPath = "app/api/payroll/runs/[id]/results/route.ts";
const results = await source(resultPath);
expect(resultPath, results, /can\(ctx,\s*"payroll:prepare"\)/, "result loading must require payroll preparation authority");
expect(resultPath, results, /mutationOriginAllowed/, "payroll result mutation must be origin protected");
expect(resultPath, results, /PayrollRunStatus\.DRAFT[\s\S]*PayrollRunStatus\.EXCEPTION/, "result corrections must be limited to draft or exception states");
expect(resultPath, results, /calculatePayrollLedger/, "result totals must be calculated server-side from governed line items");
expect(resultPath, results, /payrollLineItem\.deleteMany[\s\S]*payrollResult\.upsert[\s\S]*payrollLineItem\.createMany/, "result replacement must atomically replace the line ledger");
expect(resultPath, results, /TransactionIsolationLevel\.Serializable/, "payroll result writes must use serializable isolation");
expect(resultPath, results, /payroll-result\.loaded/, "payroll result loads must emit restricted audit evidence");

const runPath = "app/api/payroll/runs/route.ts";
const runs = await source(runPath);
expect(runPath, runs, /can\(ctx,\s*"payroll:prepare"\)/, "run creation must require payroll preparation authority");
expect(runPath, runs, /mutationOriginAllowed/, "run creation must be origin protected");
expect(runPath, runs, /PayrollPeriodStatus\.OPEN/, "new runs must start only in an open payroll period");
expect(runPath, runs, /ACTIVE_RUN_EXISTS/, "parallel active runs for the same period must be rejected");
expect(runPath, runs, /runNumber:\s*\(latest\?\.runNumber\s*\?\?\s*0\)\s*\+\s*1/, "run numbering must be generated on the server");
expect(runPath, runs, /payroll-run\.created/, "run ownership must be evidenced through audit");
expect(runPath, runs, /TransactionIsolationLevel\.Serializable/, "run creation must use serializable isolation");

const transitionPath = "app/api/payroll/runs/[id]/transition/route.ts";
const transition = await source(transitionPath);
expect(transitionPath, transition, /PayrollRunStatus\.APPROVED[\s\S]*"payroll:approve"/, "approval transition must require payroll approval authority");
expect(transitionPath, transition, /PayrollRunStatus\.PAID[\s\S]*"payroll:pay"/, "payment transition must require payroll payment authority");
expect(transitionPath, transition, /creatorAudit\?\.actorId\s*===\s*ctx\.actorId/, "run creator must not approve their own payroll run");
expect(transitionPath, transition, /current\.approvedById\s*===\s*ctx\.actorId/, "approver must not mark the same payroll run paid");
expect(transitionPath, transition, /getPayrollRunReadiness/, "validation and calculation must be blocked by unresolved payroll inputs");
expect(transitionPath, transition, /computePayrollInputFingerprint/, "input lock must capture a deterministic fingerprint");
expect(transitionPath, transition, /assertInputFingerprint/, "calculation, approval and payment must reject post-lock input drift");
expect(transitionPath, transition, /PayrollPeriodStatus\.INPUT_LOCKED/, "run validation must lock the payroll period inputs");
expect(transitionPath, transition, /PayrollPeriodStatus\.CALCULATING/, "calculated runs must coordinate the payroll period calculation state");
expect(transitionPath, transition, /PayrollPeriodStatus\.REVIEW/, "approval routing must coordinate the payroll period review state");
expect(transitionPath, transition, /PayrollPeriodStatus\.APPROVED/, "independent approval must coordinate the payroll period approval state");
expect(transitionPath, transition, /PayrollPeriodStatus\.PAID/, "payment must coordinate the payroll period payment state");
expect(transitionPath, transition, /updateMany/, "run and period transitions must use state-aware writes");
expect(transitionPath, transition, /TransactionIsolationLevel\.Serializable/, "payroll transitions must use serializable isolation");
expect(transitionPath, transition, /enqueuePayrollApprovalNotification/, "approval-ready payroll must notify the payroll decision queue");
expect(transitionPath, transition, /enqueuePayrollApprovedNotification/, "approved payroll must notify its preparation owner");
expect(transitionPath, transition, /enqueuePayrollPaidNotification/, "paid payroll must emit a durable notification");

const periodPath = "app/api/payroll/periods/route.ts";
const periods = await source(periodPath);
expect(periodPath, periods, /can\(ctx,\s*"payroll:configure"\)/, "period creation must require payroll configuration authority");
expect(periodPath, periods, /mutationOriginAllowed/, "period creation must be origin protected");
expect(periodPath, periods, /startsAt\s*>=\s*endsAt/, "period date ordering must be validated");
expect(periodPath, periods, /payDate\s*<\s*endsAt/, "pay date cannot precede the payroll period end");
expect(periodPath, periods, /PERIOD_OVERLAP/, "overlapping periods for the same country pack must be rejected");

const packPath = "app/api/payroll/country-packs/route.ts";
const packs = await source(packPath);
expect(packPath, packs, /can\(ctx,\s*"payroll:configure"\)/, "country-pack creation must require payroll configuration authority");
expect(packPath, packs, /mutationOriginAllowed/, "country-pack mutation must be origin protected");
expect(packPath, packs, /\^\[A-Z\]\{2\}\$/, "country codes must be normalized and validated");
expect(packPath, packs, /\^\[A-Z\]\{3\}\$/, "currency codes must be normalized and validated");

const notificationsPath = "lib/payroll-notifications.ts";
const notifications = await source(notificationsPath);
expect(notificationsPath, notifications, /PAYROLL_APPROVAL_REQUIRED/, "payroll approval must have a dedicated durable notification");
expect(notificationsPath, notifications, /PAYROLL_RUN_APPROVED/, "payroll approval result must have a dedicated durable notification");
expect(notificationsPath, notifications, /PAYROLL_RUN_PAID/, "payroll payment must have a dedicated durable notification");
expect(notificationsPath, notifications, /DataClassification\.RESTRICTED/, "payroll notification payloads must remain restricted");

if (failures.length) {
  console.error("Payroll governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated payroll governance contract: granular authority, controlled period setup, server-owned ledger totals, input readiness and fingerprint locking, four-eyes approval, payment separation, state-aware lifecycle and durable notifications are enforced.");
