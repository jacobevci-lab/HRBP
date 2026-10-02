import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { MAINTENANCE_JOBS } from "../lib/maintenance-protocol.mjs";

const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }
const routePath = "app/api/internal/maintenance/route.ts";
const route = await readFile(routePath, "utf8");
expect(routePath, route, /export async function GET[\s\S]*internalBearerAuthorized/, "capability discovery must be authenticated");
expect(routePath, route, /export async function POST[\s\S]*internalBearerAuthorized[\s\S]*selectMaintenanceJobs[\s\S]*executeMaintenanceJobs/, "authentication and selector validation must precede execution");
expect(routePath, route, /cache-control.*no-store/, "internal maintenance responses must not be cached");
expect(routePath, route, /Successful jobs were allowed to complete/, "partial failures must preserve successful results");
expect(routePath, route, /failures, data, execution[\s\S]*500/, "partial failures must remain failing HTTP responses with job evidence");
reject(routePath, route, /import\s*\{[^}]*\}\s*from\s*["']@\/lib\/(?:db|[a-z-]+maintenance|[a-z-]+reminders|audit-monitoring)["']/, "domain modules must be lazy-loaded instead of initialized by every request");
for (const job of MAINTENANCE_JOBS) {
  expect(routePath, route, new RegExp(`case "${job}": return \\(await import`), `missing lazy loader for ${job}`);
}
const declaration = await readFile("lib/maintenance-protocol.d.mts", "utf8");
for (const job of MAINTENANCE_JOBS) expect("maintenance-protocol.d.mts", declaration, new RegExp(`"${job}"`), "runtime and TypeScript job manifests must agree");

const workflowPath = ".github/workflows/operational-maintenance.yml";
const workflow = await readFile(workflowPath, "utf8");
expect(workflowPath, workflow, /node scripts\/run-operational-maintenance\.mjs/, "scheduler must use the protocol-aware single-job runner");
expect(workflowPath, workflow, /group: hrbp-operational-maintenance[\s\S]*cancel-in-progress: false/, "scheduled and manual maintenance must share non-cancelling serialization");
expect(workflowPath, workflow, /timeout-minutes: 20/, "scheduler execution must be bounded");
reject(workflowPath, workflow, /--retry|cat\s+["']?\$response_file/, "scheduler must not blindly replay writes or log raw upstream bodies");
const ci = await readFile(".github/workflows/ci.yml", "utf8");
expect("ci.yml", ci, /node scripts\/smoke-maintenance-protocol\.mjs/, "CI must exercise the real authenticated single-job Worker route");
expect("ci.yml", ci, /-X POST http:\/\/127\.0\.0\.1:8787\/api\/internal\/maintenance\s*\\/, "CI must retain the no-selector compatibility smoke test");
if (failures.length) {
  console.error("Maintenance resilience validation failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
// These execute production orchestration/runner code, not source-text approximations of behavior.
const behavior = spawnSync(process.execPath, ["--test", "scripts/maintenance-protocol.test.mjs", "scripts/service-sla-policy.test.mjs"], { stdio: "inherit" });
if (behavior.error || behavior.status !== 0) process.exit(1);
console.log("Maintenance resilience contract and behavioral validation passed.");
