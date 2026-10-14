import assert from "node:assert/strict";
import test from "node:test";
import { assertAuditIntegrityRun } from "../lib/audit-integrity-outcome.mjs";
import { executeMaintenanceJobs } from "../lib/maintenance-protocol.mjs";

test("valid or empty audit sample keeps the scheduler successful", async () => {
  for (const report of [{ tenantsChecked: 3, failed: 0, verified: 3 }, { tenantsChecked: 0, failed: 0, empty: 0 }]) {
    assert.strictEqual(assertAuditIntegrityRun(report), report);
  }
});

test("detected audit corruption becomes structured failure and cannot be a green maintenance job", async () => {
  let notificationsQueued = 0;
  const run = await executeMaintenanceJobs(["audit-integrity"], async () => {
    notificationsQueued += 1; // The application enqueues alerts before checking final outcome.
    return assertAuditIntegrityRun({ tenantsChecked: 3, failed: 1, notificationsQueued });
  });
  assert.equal(notificationsQueued, 1);
  assert.deepEqual(run.failures, [{ job: "audit-integrity", type: "Error", code: "AUDIT_INTEGRITY_FAILURE" }]);
  assert.equal(run.execution.jobs[0].status, "failed");
  assert.equal(run.results.auditIntegrity, null);
});

test("missing or inconsistent monitoring results also fail closed", () => {
  for (const report of [null, undefined, {}, { tenantsChecked: 1, failed: 2 }, { tenantsChecked: 1, failed: -1 }, { tenantsChecked: 2, failed: "0" }]) {
    assert.throws(() => assertAuditIntegrityRun(report), e => e.code === "AUDIT_INTEGRITY_RESULT_INVALID");
  }
});

test("administrative alert carries a bounded code, not employee data", () => {
  assert.throws(() => assertAuditIntegrityRun({ tenantsChecked: 2, failed: 1, secret: "private-worker-payload" }),
    e => e.code === "AUDIT_INTEGRITY_FAILURE" && !e.message.includes("private-worker-payload"));
});
