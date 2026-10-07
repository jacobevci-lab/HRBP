import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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

test("restore helper preserves and clears the durable ambiguous-outcome latch", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hrbp-scheduler-restore-"));
  const source = path.join(dir, "scheduler-status.json");
  const env = { ...process.env, HRBP_MAINTENANCE_STATE_DIR: dir };
  const run = () => spawnSync(process.execPath, ["scripts/onprem-restore-scheduler-state.mjs", source], {
    cwd: process.cwd(), env, encoding: "utf8"
  });
  try {
    await writeFile(source, JSON.stringify({
      blocked: {
        at: "2026-10-07T01:02:03.000Z",
        job: "audit-integrity",
        code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY"
      }
    }));
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readStateFile(dir, "blocked.json"), {
      at: "2026-10-07T01:02:03.000Z",
      reason: "Restored backup recorded an ambiguous maintenance POST outcome. Inspect restored application state before explicitly resuming scheduled maintenance.",
      job: "audit-integrity",
      code: "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY",
      restoredFromBackup: true
    });

    await writeFile(source, JSON.stringify({ blocked: null }));
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await readStateFile(dir, "blocked.json"))?.code, "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY");

    await writeStateFile(dir, "blocked.json", { at: "2026-10-07T02:00:00.000Z", job: "workflow-reminders", code: "UNEXPECTED_RESPONSE_STOPPED" });
    await writeFile(source, JSON.stringify({ available: false, reason: "maintenance-scheduler-not-running" }));
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await readStateFile(dir, "blocked.json"))?.code, "UNEXPECTED_RESPONSE_STOPPED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
