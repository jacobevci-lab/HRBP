import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /finalSettlementReversalReason\s+String\?/, "settlement reversal reason must be persisted");
expect(schemaPath, schema, /finalSettlementReversedById\s+String\?/, "settlement reversal actor must be persisted");
expect(schemaPath, schema, /finalSettlementReversedAt\s+DateTime\?/, "settlement reversal time must be persisted");

const routePath = "app/api/offboarding/processes/[id]/final-settlement/route.ts";
const route = await source(routePath);
expect(routePath, route, /SettlementAction[\s\S]*REVERSE/, "final settlement lifecycle must support governed reversal");
expect(routePath, route, /action\s*===\s*"REVERSE"[\s\S]*note\.length\s*<\s*10/, "reversal must require a meaningful bounded reason");
expect(routePath, route, /REVERSE"\)\s*&&\s*!can\(ctx,\s*"payroll:pay"\)/, "reversal must require payroll payment authority");
expect(routePath, route, /finalSettlementSettledById\s*===\s*ctx\.actorId[\s\S]*FOUR_EYES_REVERSAL/, "the settlement confirmer must not reverse their own settlement");
expect(routePath, route, /current\s*!==\s*statuses\.settled[\s\S]*INVALID_TRANSITION/, "only settled final payments may be reversed");
expect(routePath, route, /finalSettlementStatus:\s*next[\s\S]*finalSettlementReversalReason:\s*note[\s\S]*finalSettlementReversedById:\s*ctx\.actorId[\s\S]*finalSettlementReversedAt:\s*now/, "reversal must persist state, reason, actor and time");
expect(routePath, route, /offboarding\.final-settlement-reversed/, "reversal must append restricted audit evidence");
expect(routePath, route, /final-settlement:repayment:/, "reversal must create a fresh repayment notification intent");
expect(routePath, route, /recalculateSeparationReadiness/, "reversal must immediately reopen readiness when settlement is no longer clear");
expect(routePath, route, /TransactionIsolationLevel\.Serializable/, "settlement reversal must remain serializable");

const readinessPath = "lib/offboarding-readiness.ts";
const readiness = await source(readinessPath);
expect(readinessPath, readiness, /nextStatus\s*!==\s*SeparationStatus\.READY_TO_CLOSE[\s\S]*OFFBOARDING_READY_TO_CLOSE[\s\S]*readAt:\s*now/, "readiness regression must retire stale ready-to-close notifications");
expect(readinessPath, readiness, /updatedAt:\s*true/, "readiness must select a transition generation token");
expect(readinessPath, readiness, /ready-to-close:\$\{process\.updatedAt\.toISOString\(\)\}/, "re-entering ready-to-close must create a fresh dedupe generation");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /finalSettlementReversalReason[\s\S]*finalSettlementReversedById[\s\S]*finalSettlementReversedAt/, "live offboarding data must expose settlement reversal evidence");

const historyPath = "lib/offboarding-history-data.ts";
const history = await source(historyPath);
expect(historyPath, history, /finalSettlementReversedAt[\s\S]*Final settlement reversed under four-eyes control/, "terminal history must reconstruct settlement reversal evidence");

const consolePath = "components/offboarding-final-settlement-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /SettlementAction[\s\S]*REVERSE/, "settlement console must expose reversal action");
expect(consolePath, consoleSource, /settledByMe[\s\S]*Independent payroll payment authority required/, "reversal UI must enforce four-eyes guidance");
expect(consolePath, consoleSource, /minLength=\{10\}[\s\S]*maxLength=\{2000\}/, "reversal reason UI must mirror server bounds");
expect(consolePath, consoleSource, /transition\(process\.id,\s*"REVERSE"\)/, "reversal UI must call the governed settlement endpoint");

if (failures.length) {
  console.error("Offboarding settlement-reversal validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Offboarding settlement-reversal validation passed.");
