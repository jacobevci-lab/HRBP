import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const path = "lib/csv.ts";
const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true
});
assert.equal((compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
runInNewContext(compiled.outputText, { module, exports: module.exports }, { filename: path, timeout: 2000 });
const { safeCsvCell } = module.exports;

test("CSV cells quote values and escape embedded quotes", () => {
  assert.equal(safeCsvCell('Ada "A"'), '"Ada ""A"""');
  assert.equal(safeCsvCell(null), '""');
  assert.equal(safeCsvCell(undefined), '""');
});

test("CSV cells neutralize spreadsheet formulas even after leading whitespace", () => {
  for (const value of ["=1+1", "+SUM(1,2)", "-10", "@cmd", " =1+1", "\t=1+1", "\r\n@cmd"]) {
    const encoded = safeCsvCell(value);
    assert.ok(encoded.startsWith('"\''), value);
    assert.ok(encoded.endsWith('"'), value);
  }
  assert.equal(safeCsvCell(" normal text"), '" normal text"');
  assert.equal(safeCsvCell("ACTIVE"), '"ACTIVE"');
});

test("all governed CSV exports consume the shared hardened cell helper", () => {
  for (const route of [
    "app/api/core-hr/export/route.ts",
    "app/api/audit/export/route.ts",
    "app/api/action-center/history/export/route.ts"
  ]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /import \{ safeCsvCell \} from "@\/lib\/csv"/, route);
    assert.match(source, /map\(safeCsvCell\)/, route);
  }
  const actionCenter = readFileSync("app/api/action-center/history/export/route.ts", "utf8");
  assert.match(actionCenter, /"x-content-type-options": "nosniff"/);
});
