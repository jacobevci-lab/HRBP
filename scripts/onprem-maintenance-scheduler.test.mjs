import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ambiguousStop,
  boundedRunEvidence,
  parseIntervalSeconds,
  readStateFile,
  schedulerHealth,
  writeStateFile
} from "./onprem-maintenance-state.mjs";

test("maintenance interval is bounded and defaults to fifteen minutes", () => {
  assert.equal(parseIntervalSeconds(undefined), 900);
  assert.equal(parseIntervalSeconds("300"), 300);
  assert.equal(parseIntervalSeconds("86400"), 86400);
  for (const value of ["", null]) assert.equal(parseIntervalSeconds(value), 900);
  for (const value of ["299", "86401", "-1", "1.5", "abc"]) assert.throws(() => parseIntervalSeconds(value));
});

test("only ambiguous POST outcomes latch automatic maintenance", () => {
  assert.deepEqual(
    ambiguousStop({ stopped: true, results: [{ job: "audit-integrity", code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY" }] }),
    { job: "audit-integrity", code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY" }
  );
  assert.deepEqual(
    ambiguousStop({ stopped: true, results: [{ job: "workflow-reminders", code: "UNEXPECTED_RESPONSE_STOPPED" }] }),
    { job: "workflow-reminders", code: "UNEXPECTED_RESPONSE_STOPPED" }
  );
  assert.equal(ambiguousStop({ stopped: true, results: [{ job: "preflight", code: "PREFLIGHT_UNAVAILABLE" }] }), null);
  assert.equal(ambiguousStop({ stopped: false, results: [{ job: "learning-lifecycle", code: "JOB_FAILED" }] }), null);
});

test("persisted run evidence is bounded and strips arbitrary response fields", () => {
  const secret = "private-person-and-sql-content";
  const evidence = boundedRunEvidence({
    success: false,
    stopped: true,
    requested: 11,
    results: [{
      job: "audit-integrity",
      status: "failed",
      httpStatus: 500,
      durationMs: 12.7,
      code: "JOB_FAILED",
      raw: secret,
      data: { secret }
    }]
  }, new Date("2026-10-07T00:00:00.000Z"));
  assert.deepEqual(evidence, {
    completedAt: "2026-10-07T00:00:00.000Z",
    success: false,
    stopped: true,
    requested: 11,
    results: [{
      job: "audit-integrity",
      status: "failed",
      httpStatus: 500,
      durationMs: 13,
      code: "JOB_FAILED"
    }]
  });
  assert.ok(!JSON.stringify(evidence).includes(secret));
});

test("scheduler health distinguishes blocked, stale and failed runs", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");
  const heartbeat = { at: "2026-10-07T11:59:30.000Z" };
  assert.deepEqual(schedulerHealth({ blocked: { code: "x" }, heartbeat, lastRun: null, intervalSeconds: 900, now }),
    { healthy: false, code: "BLOCKED_UNKNOWN_OUTCOME" });
  assert.deepEqual(schedulerHealth({ blocked: null, heartbeat: null, lastRun: null, intervalSeconds: 900, now }),
    { healthy: false, code: "HEARTBEAT_MISSING" });
  assert.deepEqual(schedulerHealth({ blocked: null, heartbeat: { at: "2026-10-07T11:00:00.000Z" }, lastRun: null, intervalSeconds: 900, now }),
    { healthy: false, code: "HEARTBEAT_STALE" });
  assert.deepEqual(schedulerHealth({ blocked: null, heartbeat, lastRun: { success: false }, intervalSeconds: 900, now }),
    { healthy: false, code: "LAST_RUN_FAILED" });
  assert.deepEqual(schedulerHealth({ blocked: null, heartbeat, lastRun: { success: true }, intervalSeconds: 900, now }),
    { healthy: true, code: "OK" });
});

test("scheduler state writes atomically and reads back structured JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hrbp-scheduler-"));
  try {
    await writeStateFile(dir, "blocked.json", { at: "2026-10-07T00:00:00.000Z", code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY" });
    assert.deepEqual(await readStateFile(dir, "blocked.json"), {
      at: "2026-10-07T00:00:00.000Z",
      code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY"
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
