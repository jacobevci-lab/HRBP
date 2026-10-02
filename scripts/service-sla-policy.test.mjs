import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serviceSlaPolicy } from "../lib/service-sla-policy.mjs";

const now = new Date("2026-10-02T12:00:00.000Z");
const policy = serviceSlaPolicy(now);
const after = (ms) => new Date(now.getTime() + ms);
function eligible(filter, level, dueAt) {
  return dueAt !== null && filter.OR.some((condition) => level < condition.escalationLevel.lt && dueAt <= condition.slaDueAt.lte);
}

for (const [offset, level] of [[120 * 60_000 + 1, 0], [120 * 60_000, 1], [59_999, 1], [1, 1], [0, 2], [-1, 2], [-1440 * 60_000 + 1, 2], [-1440 * 60_000, 3]]) {
  test(`SLA boundary ${offset}ms gives level ${level}`, () => assert.equal(policy.target(after(offset)).level, level));
}

test("SQL candidate eligibility matches target decisions for every escalation level", () => {
  const offsets = [-2000 * 60_000, -1440 * 60_000, -1440 * 60_000 + 1, -1, 0, 1, 59_999, 120 * 60_000, 120 * 60_000 + 1, 200 * 60_000];
  for (let level = 0; level <= 3; level += 1) {
    for (const offset of offsets) {
      const dueAt = after(offset);
      assert.equal(eligible(policy.where, level, dueAt), policy.target(dueAt).level > level);
    }
    assert.equal(eligible(policy.where, level, null), false);
  }
});

test("already-escalated rows cannot consume the actionable candidate batch", () => {
  const oldRows = Array.from({ length: 500 }, (_, id) => ({ id, escalationLevel: 3, slaDueAt: after(-2000 * 60_000 - id) }));
  const pending = { id: 501, escalationLevel: 0, slaDueAt: after(-1) };
  const selected = [...oldRows, pending].filter((row) => eligible(policy.where, row.escalationLevel, row.slaDueAt)).slice(0, 500);
  assert.deepEqual(selected, [pending]);
});

test("advanced levels are never lowered and custom warning/severe windows agree", () => {
  const custom = serviceSlaPolicy(now, 30, 60);
  assert.equal(custom.target(after(30 * 60_000)).level, 1);
  assert.equal(custom.target(after(30 * 60_000 + 1)).level, 0);
  assert.equal(custom.target(after(-60 * 60_000)).level, 3);
  assert.equal(eligible(custom.where, 3, after(-60 * 60_000)), false);
});

test("invalid deadlines and overflowing thresholds fail explicitly; invalid numeric settings use safe defaults", () => {
  assert.throws(() => serviceSlaPolicy(new Date("invalid")), TypeError);
  assert.throws(() => policy.target(new Date("invalid")), TypeError);
  assert.throws(() => serviceSlaPolicy(now, Number.MAX_VALUE), RangeError);
  const defaults = serviceSlaPolicy(now, NaN, Infinity);
  assert.equal(defaults.target(after(120 * 60_000)).level, 1);
  const minimum = serviceSlaPolicy(now, -1, 0);
  assert.equal(minimum.target(after(15 * 60_000)).level, 1);
  assert.equal(minimum.target(after(-60 * 60_000)).level, 3);
});

test("policy snapshots the evaluation clock instead of retaining the caller's mutable Date", () => {
  const mutable = new Date(now);
  const snapshot = serviceSlaPolicy(mutable);
  mutable.setTime(0);
  assert.equal(snapshot.target(after(1)).level, 1);
});

test("operational query filters actionable rows before batching and guards stale writes", async () => {
  const source = await readFile("lib/operational-maintenance.ts", "utf8");
  assert.match(source, /where:\s*\{\s*\.\.\.slaPolicy\.where,[\s\S]*take: maxBatch/);
  assert.match(source, /orderBy:\s*\[\{ slaDueAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(source, /const target = slaPolicy\.target\(slaDueAt\)/);
  const update = source.slice(source.indexOf("tx.hRServiceRequest.updateMany"), source.indexOf("if (result.count !== 1)"));
  for (const field of ["tenantId", "escalationLevel", "assigneeId", "queue"]) {
    assert.ok(update.includes(`${field}: candidate.${field}`), `compare-and-swap must protect ${field}`);
  }
  assert.match(update, /slaDueAt,/);
  assert.match(update, /status: \{ notIn: terminalServiceStatuses \}/);
});
