import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/audit/export/route.ts", "utf8");

test("Audit Ledger export detects truncation instead of returning incomplete evidence", () => {
  assert.match(source, /const AUDIT_EXPORT_LIMIT = 5000/);
  assert.match(source, /take: AUDIT_EXPORT_LIMIT \+ 1/);
  assert.match(source, /rows\.length > AUDIT_EXPORT_LIMIT/);
  assert.match(source, /status: 422/);
  assert.match(source, /Narrow the filters or time window before exporting/);
  assert.match(source, /"cache-control": "no-store"/);
  assert.match(source, /"x-content-type-options": "nosniff"/);
});

test("Audit Ledger successful export remains a native hardened CSV download", () => {
  assert.match(source, /import \{ safeCsvCell \} from "@\/lib\/csv"/);
  assert.match(source, /map\(safeCsvCell\)/);
  assert.match(source, /content-disposition/);
  assert.match(source, /text\/csv; charset=utf-8/);
  assert.match(source, /\\uFEFF/);
});
