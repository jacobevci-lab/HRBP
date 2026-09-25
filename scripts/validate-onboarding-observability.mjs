import { readFile } from "node:fs/promises";

const path = "components/onboarding-operations-console.tsx";
const source = await readFile(path, "utf8");
const failures = [];
function expect(pattern, message) { if (!pattern.test(source)) failures.push(`${path}: ${message}`); }

expect(/START_RISK_WINDOW_MS\s*=\s*72\s*\*\s*60\s*\*\s*60\s*\*\s*1000/, "operations console must expose the same 72-hour start-risk horizon used by readiness monitoring");
expect(/blockedTaskCount\s*=\s*tasks\.filter\(\(task\)\s*=>\s*task\.status\s*===\s*"BLOCKED"\)/, "blocked tasks must be aggregated into an operational risk signal");
expect(/overdueTaskCount\s*=\s*tasks\.filter\([\s\S]*!terminalTaskStatuses\.has\(task\.status\)[\s\S]*dueDate[\s\S]*<\s*now/, "non-terminal tasks past due date must be counted as overdue");
expect(/startRiskPlanIds\s*=\s*new Set\([\s\S]*planStatus\s*!==\s*"COMPLETED"[\s\S]*START_RISK_WINDOW_MS/, "open plans approaching start date must be aggregated without double-counting tasks");
expect(/activationReadyPlanIds\s*=\s*new Set\([\s\S]*planStatus\s*===\s*"COMPLETED"[\s\S]*employmentStatus\s*===\s*"PREBOARDING"/, "completed preboarding handoffs must have a dedicated activation-ready KPI");
expect(/labelText=\{c\("Blocked tasks","Engelli görevler"\)\}/, "blocked-task KPI must be visible and localized");
expect(/labelText=\{c\("Overdue tasks","Gecikmiş görevler"\)\}/, "overdue-task KPI must be visible and localized");
expect(/labelText=\{c\("Start-date risk","Başlangıç tarihi riski"\)\}/, "start-date risk KPI must be visible and localized");
expect(/labelText=\{c\("Ready to activate","Aktivasyona hazır"\)\}/, "activation-ready KPI must be visible and localized");
expect(/taskOverdue\s*=\s*!terminalTaskStatuses\.has\(task\.status\)/, "task rows must calculate overdue state without flagging completed or waived tasks");
expect(/c\("OVERDUE","GECİKMİŞ"\)/, "overdue task rows must expose a localized visual warning");
expect(/startRisk\s*\?\s*` · \$\{c\("start risk <72h","başlangıç riski <72s"\)\}`/, "journey headers must surface the start-risk state directly");

if (failures.length) {
  console.error("Onboarding observability validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Onboarding observability validation passed.");
