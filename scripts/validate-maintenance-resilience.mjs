import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const routePath = "app/api/internal/maintenance/route.ts";
const route = await source(routePath);
expect(routePath, route, /async function capture<T>/, "maintenance jobs must use a shared failure-isolation wrapper");
expect(routePath, route, /benefits-lifecycle[\s\S]*learning-lifecycle[\s\S]*recruiting-lifecycle[\s\S]*onboarding-readiness[\s\S]*offboarding-readiness/, "audited lifecycle and readiness jobs must remain serialized in order");
expect(routePath, route, /Promise\.all\([\s\S]*workflow-reminders[\s\S]*learning-reminders[\s\S]*succession-reminders[\s\S]*development-plan-reminders[\s\S]*audit-integrity/, "independent reminder jobs should continue concurrently with isolated failures");
expect(routePath, route, /successful jobs were allowed to complete/i, "partial maintenance failure must explain that successful jobs still completed");
expect(routePath, route, /failures,[\s\S]*data[\s\S]*status:\s*500/, "maintenance must return structured failed-job evidence while retaining a failing scheduler status");
expect(routePath, route, /type:\s*typeof value\?\.name[\s\S]*code:/, "failure response must expose bounded machine diagnostics");
expectAbsent(routePath, route, /message:\s*error instanceof Error \? error\.message/, "internal maintenance response must not echo arbitrary exception messages");

const workflowPath = ".github/workflows/operational-maintenance.yml";
const workflow = await source(workflowPath);
expect(workflowPath, workflow, /cat \"\$response_file\"/, "scheduler must print the structured maintenance response for diagnosis");
expect(workflowPath, workflow, /http_code[\s\S]*-lt 200[\s\S]*-ge 300/, "scheduler must continue failing when any maintenance job reports failure");

if (failures.length) {
  console.error("Maintenance resilience validation failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Maintenance resilience validation passed.");
