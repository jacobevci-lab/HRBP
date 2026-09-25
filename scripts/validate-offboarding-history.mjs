import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const dataPath = "lib/offboarding-history-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /TERMINAL_STATUSES[\s\S]*SeparationStatus\.CLOSED[\s\S]*SeparationStatus\.CANCELLED/, "history must be limited to terminal separation states");
expect(dataPath, data, /employmentIdFilter\(scope\)/, "terminal history must respect employment relationship scope");
expect(dataPath, data, /employmentPrimaryKeyFilter\(scope\)/, "history identity lookup must remain within relationship scope");
expect(dataPath, data, /take:\s*100/, "terminal history must use a bounded process query");
expect(dataPath, data, /includeAudit[\s\S]*auditEvent\.findMany/, "raw audit evidence must be capability-gated");
expect(dataPath, data, /resourceType:\s*"SeparationProcess"[\s\S]*resourceType:\s*"Employment"/, "audit evidence must include process and final employment termination resources");
expect(dataPath, data, /take:\s*1000/, "audit evidence query must remain bounded");
expect(dataPath, data, /cancellationReason[\s\S]*cancelledById[\s\S]*cancelledAt/, "cancelled processes must expose governed cancellation evidence");
expect(dataPath, data, /finalSettlementPreparedAt[\s\S]*finalSettlementApprovedAt[\s\S]*finalSettlementSettledAt/, "history must reconstruct settlement evidence");
expect(dataPath, data, /exitInterview[\s\S]*rehireDecisionAt/, "history must preserve interview and explicit human rehire decision evidence");

const componentPath = "components/offboarding-history.tsx";
const component = await source(componentPath);
expectAbsent(componentPath, component, /"use client"/, "terminal history should remain a server-rendered read-only surface");
expectAbsent(componentPath, component, /fetch\(/, "terminal history must not expose mutation calls");
expect(componentPath, component, /Immutable exit history|Değiştirilemez ayrılış geçmişi/, "history UI must describe immutable evidence semantics");
expect(componentPath, component, /Evidence timeline|Kanıt zaman çizgisi/, "history UI must expose a domain evidence timeline");
expect(componentPath, component, /Immutable audit evidence|Değiştirilemez audit kanıtı/, "history UI must distinguish raw audit evidence");
expect(componentPath, component, /audit:read required|audit:read gerekli/, "history UI must make raw audit capability boundary explicit");
expect(componentPath, component, /Cancelled without employment termination|İstihdam sonlandırılmadan iptal edildi/, "history UI must distinguish cancellation from termination");

const workspacePath = "components/offboarding-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /getOffboardingHistoryData\(ctx,can\(ctx,"audit:read"\)\)/, "workspace must gate raw audit evidence with audit:read");
expect(workspacePath, workspace, /getOffboardingHistoryData[\s\S]*\.catch\(/, "history failure must not take the active offboarding workflow offline");
expect(workspacePath, workspace, /<OffboardingHistory data=\{history\} locale=\{locale\}/, "terminal history must be rendered in the offboarding workspace");

if (failures.length) {
  console.error("Offboarding terminal-history validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Offboarding terminal-history validation passed.");
