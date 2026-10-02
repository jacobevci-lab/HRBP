import assert from "node:assert/strict";
import { runMaintenance } from "./run-operational-maintenance.mjs";

// This script intentionally cannot target a live host. Production scheduling uses the runner.
const endpoint = "http://127.0.0.1:8787/api/internal/maintenance";
const token = process.env.HRBP_MAINTENANCE_TOKEN;
assert.ok(token && token.length >= 24, "A CI maintenance token is required.");
const options = { redirect: "error", signal: AbortSignal.timeout(10_000) };
for (const method of ["GET", "POST"]) {
  const response = await fetch(endpoint, { ...options, method });
  assert.equal(response.status, 401, `${method} must require internal authentication`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await response.arrayBuffer();
}
for (const query of ["job=", "job=unknown", "job=__proto__", "job=audit-integrity&job=audit-integrity"]) {
  const response = await fetch(`${endpoint}?${query}`, {
    ...options, method: "POST", headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 400, "Invalid selectors must not execute the compatibility all-jobs path");
  await response.arrayBuffer();
}
const report = await runMaintenance({ url: endpoint, token, localSmoke: true,
  log: (result) => console.log(JSON.stringify(result)) });
assert.equal(report.success, true, "All individually selected maintenance jobs must succeed against the local Worker and PostgreSQL");
console.log("Authenticated capability probe, selector rejection and all eleven single-job Worker invocations passed.");
