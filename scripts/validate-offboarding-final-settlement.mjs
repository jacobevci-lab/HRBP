import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /finalSettlementStatus\s+String\?/, "separation must persist final settlement state");
expect(schemaPath, schema, /finalSettlementPreparedById\s+String\?[\s\S]*finalSettlementApprovedById\s+String\?[\s\S]*finalSettlementSettledById\s+String\?/, "settlement must preserve preparation, approval and settlement actor provenance");
expect(schemaPath, schema, /finalSettlementPreparedAt\s+DateTime\?[\s\S]*finalSettlementApprovedAt\s+DateTime\?[\s\S]*finalSettlementSettledAt\s+DateTime\?/, "settlement must preserve lifecycle timestamps");

const routePath = "app/api/offboarding/processes/[id]/final-settlement/route.ts";
const route = await source(routePath);
expect(routePath, route, /payroll:prepare/, "preparation must require payroll preparation authority");
expect(routePath, route, /payroll:approve/, "approval must require payroll approval authority");
expect(routePath, route, /payroll:pay/, "settlement completion must require payroll payment authority");
expect(routePath, route, /PREPARE[\s\S]*APPROVE[\s\S]*SETTLE/, "final settlement must use an explicit three-step lifecycle");
expect(routePath, route, /finalSettlementPreparedById\s*===\s*ctx\.actorId/, "preparer must not approve their own settlement");
expect(routePath, route, /finalSettlementApprovedById\s*===\s*ctx\.actorId/, "approver must not complete their own settlement");
expect(routePath, route, /canActOnEmployment/, "settlement mutation must respect relationship scope");
expect(routePath, route, /separationProcess\.updateMany\([\s\S]*updatedAt:\s*process\.updatedAt[\s\S]*finalSettlementStatus:\s*process\.finalSettlementStatus/, "settlement mutation must be optimistic and state-aware");
expect(routePath, route, /TransactionIsolationLevel\.Serializable/, "settlement lifecycle must use serializable isolation");
expect(routePath, route, /offboarding\.final-settlement-prepared[\s\S]*offboarding\.final-settlement-approved[\s\S]*offboarding\.final-settlement-settled/, "all settlement decisions must be audited");
expect(routePath, route, /OFFBOARDING_FINAL_SETTLEMENT_APPROVAL_REQUIRED[\s\S]*OFFBOARDING_FINAL_SETTLEMENT_PAYMENT_REQUIRED[\s\S]*OFFBOARDING_FINAL_SETTLEMENT_SETTLED/, "settlement lifecycle must emit durable notifications");

const readinessPath = "lib/offboarding-readiness.ts";
const readiness = await source(readinessPath);
expect(readinessPath, readiness, /settledFinalSettlementStatus\s*=\s*"SETTLED"/, "settled status must be centralized");
expect(readinessPath, readiness, /finalSettlementStatus\s*===\s*settledFinalSettlementStatus/, "ready-to-close must require settled final pay");
expect(readinessPath, readiness, /operationalClear[\s\S]*FINAL_PAY_REVIEW[\s\S]*READY_TO_CLOSE|READY_TO_CLOSE[\s\S]*FINAL_PAY_REVIEW/, "operational clearance must route through final-pay review until settlement clears");

const closePath = "app/api/offboarding/processes/[id]/close/route.ts";
const close = await source(closePath);
expect(closePath, close, /finalSettlementStatus\s*!==\s*"SETTLED"/, "final employment termination must recheck final settlement");
expect(closePath, close, /finalSettlementStatus:\s*"SETTLED"/, "state-aware closure must include the settlement invariant");
expect(closePath, close, /FINAL_SETTLEMENT/, "closure must surface an explicit settlement blocker");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /finalSettlementPreparedById[\s\S]*finalSettlementApprovedById[\s\S]*finalSettlementSettledById/, "workspace data must expose settlement provenance for four-eyes UI");
expect(dataPath, data, /finalSettlementClear/, "workspace must expose final settlement readiness");
expect(dataPath, data, /finalPayReview/, "workspace metrics must surface final-pay review workload");

const consolePath = "components/offboarding-final-settlement-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/final-settlement/, "settlement console must call the governed endpoint");
expect(consolePath, consoleSource, /preparedByMe[\s\S]*!preparedByMe/, "UI must enforce independent settlement approval");
expect(consolePath, consoleSource, /approvedByMe[\s\S]*!approvedByMe/, "UI must enforce independent settlement completion");
expect(consolePath, consoleSource, /maxLength=\{2000\}/, "preparation evidence must mirror the server bound");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /can\(ctx,"payroll:prepare"\)[\s\S]*can\(ctx,"payroll:approve"\)[\s\S]*can\(ctx,"payroll:pay"\)/, "workspace must derive granular payroll settlement authorities");
expect(workspacePath, workspace, /OffboardingFinalSettlementConsole/, "authorized payroll users must receive the final settlement console");
expect(workspacePath, workspace, /Final settlement[\s\S]*independently approved|Nihai hesap[\s\S]*bağımsız onaylanmalı/, "closure guidance must include final settlement separation of duties");

const displayPath = "lib/notification-display.ts";
const display = await source(displayPath);
expect(displayPath, display, /OFFBOARDING_FINAL_SETTLEMENT_APPROVAL_REQUIRED[\s\S]*OFFBOARDING_FINAL_SETTLEMENT_PAYMENT_REQUIRED[\s\S]*OFFBOARDING_FINAL_SETTLEMENT_SETTLED/, "notification UI must localize all settlement stages");
expect(displayPath, display, /final-settlement-prepared[\s\S]*final-settlement-approved[\s\S]*final-settlement-settled/, "notification summaries must explain settlement progression");

if (failures.length) {
  console.error("Offboarding final settlement validation failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Offboarding final settlement validation passed.");
