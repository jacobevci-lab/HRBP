import test from "node:test";
import assert from "node:assert/strict";
import {
  runAuditHistoryMaintenance,
  validateAuditHistorySchedulerConfiguration
} from "./run-audit-history-maintenance.mjs";

const token = "ci-audit-history-token-1234567890";
const url = "http://app:3000/api/internal/audit-history";
function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
const capability = { data: {
  scanVersion: 1, scheduleVersion: 1,
  mode: "BOUNDED_RESUMABLE_FULL_HISTORY",
  cadence: "SEPARATE_FROM_FAST_AUDIT_INTEGRITY"
} };

test("scheduler configuration accepts only the exact private history endpoint and bounded token", () => {
  assert.equal(validateAuditHistorySchedulerConfiguration({
    url, token, privateHttpHost: "app"
  }).pathname, "/api/internal/audit-history");
  for (const bad of [
    "http://app:3000/api/internal/maintenance",
    "http://app:3000/api/internal/audit-history?tenant=x",
    "http://evil.invalid/api/internal/audit-history",
    "ftp://app:3000/api/internal/audit-history"
  ]) {
    assert.throws(() => validateAuditHistorySchedulerConfiguration({
      url: bad, token, privateHttpHost: "app"
    }));
  }
  assert.throws(() => validateAuditHistorySchedulerConfiguration({
    url, token: "too-short", privateHttpHost: "app"
  }));
});

test("one cycle performs one preflight and exactly one bounded POST", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(init.method);
    if (init.method === "GET") return response(capability);
    return response({ data: {
      scanVersion: 1, scheduleVersion: 1, selectionMode: "DURABLE_KEYSET",
      outcome: "PARTIAL", tenantUniverse: 12, eventsChecked: 250, cycleCompleted: false
    } });
  };
  const result = await runAuditHistoryMaintenance({
    url, token, privateHttpHost: "app", fetchImpl
  });
  assert.equal(result.success, true);
  assert.equal(result.outcome, "PARTIAL");
  assert.equal(result.eventsChecked, 250);
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("unknown POST outcome is never replayed inside the same scheduler cycle", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(init.method);
    if (init.method === "GET") return response(capability);
    throw new Error("simulated connection loss after unknown commit");
  };
  const result = await runAuditHistoryMaintenance({
    url, token, privateHttpHost: "app", fetchImpl, timeoutMs: 100
  });
  assert.equal(result.success, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.code, "AUDIT_HISTORY_OUTCOME_UNKNOWN_RESUME_FROM_DB_STATE");
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("known integrity failure and scheduler contention are bounded diagnostics", async () => {
  for (const [status, body, expected] of [
    [500, { code: "AUDIT_HISTORY_INTEGRITY_FAILURE" }, "AUDIT_HISTORY_INTEGRITY_FAILURE"],
    [409, { code: "AUDIT_SCHEDULE_BUSY" }, "AUDIT_HISTORY_SCHEDULE_BUSY"]
  ]) {
    const fetchImpl = async (_url, init) =>
      init.method === "GET" ? response(capability) : response(body, status);
    const result = await runAuditHistoryMaintenance({
      url, token, privateHttpHost: "app", fetchImpl
    });
    assert.equal(result.success, false);
    assert.equal(result.ambiguous, false);
    assert.equal(result.httpStatus, status);
    assert.equal(result.code, expected);
  }
});

test("protocol mismatch stops before any POST and response fields cannot bypass the contract", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(init.method);
    return response({ data: { scanVersion: 999, tenantId: "secret-tenant" } });
  };
  const result = await runAuditHistoryMaintenance({
    url, token, privateHttpHost: "app", fetchImpl
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "AUDIT_HISTORY_PROTOCOL_UNAVAILABLE_DEPLOY_REQUIRED");
  assert.deepEqual(calls, ["GET"]);
  assert.ok(!JSON.stringify(result).includes("secret-tenant"));
});

test("successful response rejects arbitrary payload fields from the returned scheduler evidence", async () => {
  const fetchImpl = async (_url, init) => init.method === "GET"
    ? response(capability)
    : response({ data: {
        scanVersion: 1, scheduleVersion: 1, selectionMode: "DURABLE_KEYSET",
        outcome: "VERIFIED", tenantUniverse: 1, eventsChecked: 7, cycleCompleted: true,
        tenantId: "must-not-escape", targetTailHash: "a".repeat(64)
      } });
  const result = await runAuditHistoryMaintenance({
    url, token, privateHttpHost: "app", fetchImpl
  });
  assert.deepEqual({
    success: result.success, outcome: result.outcome,
    eventsChecked: result.eventsChecked, cycleCompleted: result.cycleCompleted
  }, { success: true, outcome: "VERIFIED", eventsChecked: 7, cycleCompleted: true });
  assert.ok(!JSON.stringify(result).includes("must-not-escape"));
  assert.ok(!JSON.stringify(result).includes("a".repeat(64)));
});
