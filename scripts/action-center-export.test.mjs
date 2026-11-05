import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/action-center/history/export/route.ts", "utf8");

test("Action Center evidence export detects overflow rather than silently truncating", () => {
  assert.match(source, /const DECISION_EXPORT_LIMIT = 500/);
  assert.match(source, /take: DECISION_EXPORT_LIMIT \+ 1/);
  assert.match(source, /rows\.length > DECISION_EXPORT_LIMIT/);
  assert.match(source, /status: 422/);
  assert.match(source, /Narrow the time window or domain filter before exporting/);
  assert.match(source, /"cache-control": "no-store"/);
  assert.match(source, /"x-content-type-options": "nosniff"/);
});

test("Action Center evidence CSV uses the shared spreadsheet-safe helper", () => {
  assert.match(source, /import \{ safeCsvCell \} from "@\/lib\/csv"/);
  assert.match(source, /map\(safeCsvCell\)/);
  assert.match(source, /content-disposition/);
});
