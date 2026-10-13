import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path = "lib/learning-due-date.ts";
const js = ts.transpileModule(readFileSync(path, "utf8"), {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("module", "exports", js)(module, module.exports);
const { learningDueDayStartUtc, learningDueSoonExclusiveUtc } = module.exports;

function iso(date) { return date.toISOString(); }

test("due today remains actionable until the following UTC calendar day", () => {
  const dueAt = new Date("2026-10-13T00:00:00.000Z");
  const todayMorning = learningDueDayStartUtc(new Date("2026-10-13T05:00:00Z"));
  const todayLate = learningDueDayStartUtc(new Date("2026-10-13T23:59:59.999Z"));
  assert.equal(iso(todayMorning), "2026-10-13T00:00:00.000Z");
  assert.equal(iso(todayLate), "2026-10-13T00:00:00.000Z");
  assert.equal(dueAt < todayMorning, false);
  assert.equal(dueAt < todayLate, false);
  assert.equal(dueAt < learningDueDayStartUtc(new Date("2026-10-14T00:00:00Z")), true);
});

test("due-soon lookahead includes all dates through the requested last day", () => {
  const now = new Date("2026-10-13T21:17:00Z");
  const exclusive = learningDueSoonExclusiveUtc(now, 7);
  assert.equal(iso(exclusive), "2026-10-21T00:00:00.000Z");
  assert.equal(new Date("2026-10-20T23:59:59.999Z") < exclusive, true);
  assert.equal(new Date("2026-10-21T00:00:00.000Z") < exclusive, false);
});

test("calendar math is stable across month, year and daylight-saving changes", () => {
  assert.equal(
    iso(learningDueSoonExclusiveUtc(new Date("2026-12-31T16:00:00Z"), 1)),
    "2027-01-02T00:00:00.000Z"
  );
  assert.equal(
    iso(learningDueSoonExclusiveUtc(new Date("2026-03-28T20:00:00Z"), 2)),
    "2026-03-31T00:00:00.000Z"
  );
});

test("reject invalid clocks and unbounded windows instead of silently widening reminders", () => {
  assert.throws(() => learningDueDayStartUtc(new Date("invalid")), RangeError);
  for (const days of [-1, 1.5, 367, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => learningDueSoonExclusiveUtc(new Date("2026-10-13T00:00:00Z"), days), RangeError);
  }
});
