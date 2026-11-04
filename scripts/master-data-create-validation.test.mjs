import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadInputValidation() {
  const path = "lib/input-validation.ts";
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal((compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module, exports: module.exports, TextDecoder, Date, URL, RegExp, String, Number, JSON
  }, { filename: path, timeout: 2000 });
  return module.exports;
}

const validation = loadInputValidation();
const people = readFileSync("app/api/people/route.ts", "utf8");
const positions = readFileSync("app/api/positions/route.ts", "utf8");

test("strict date-only validation rejects calendar normalization", () => {
  assert.ok(validation.asDateOnly("2026-02-28") instanceof Date);
  assert.equal(validation.asDateOnly("2026-02-29"), null);
  assert.ok(validation.asDateOnly("2028-02-29") instanceof Date);
  assert.equal(validation.asDateOnly("2026-02-31"), null);
  assert.equal(validation.asDateOnly("2026-13-01"), null);
  assert.equal(validation.asDateOnly("2026-01-01T00:00:00Z"), null);
});

test("work email validation is bounded, normalized and rejects whitespace or malformed separators", () => {
  assert.equal(validation.asEmailAddress(" User.Name@Example.COM "), "user.name@example.com");
  assert.equal(validation.asEmailAddress("missing-at.example.com"), null);
  assert.equal(validation.asEmailAddress("@example.com"), null);
  assert.equal(validation.asEmailAddress("user@"), null);
  assert.equal(validation.asEmailAddress("a@@example.com"), null);
  assert.equal(validation.asEmailAddress("user name@example.com"), null);
  assert.equal(validation.asEmailAddress("x".repeat(250) + "@a.com"), null);
});

test("employee create API consumes bounded server-side field validators", () => {
  assert.match(people, /asIdentifier\(body\.employeeNumber, 64\)/);
  assert.match(people, /asText\(body\.givenName, 100\)/);
  assert.match(people, /asText\(body\.familyName, 100\)/);
  assert.match(people, /asEmailAddress\(body\.workEmail\)/);
  assert.match(people, /asIdentifier\(body\.positionId\)/);
  assert.match(people, /asDateOnly\(body\.startDate\)/);
  assert.doesNotMatch(people, /workEmail\.includes\("@"\)/);
  assert.doesNotMatch(people, /new Date\(\`\$\{startDateValue\}/);
});

test("position create API bounds identifiers, text, optionals and enum status", () => {
  assert.match(positions, /asIdentifier\(body\.positionCode, 64\)/);
  assert.match(positions, /asText\(body\.title, 160\)/);
  assert.match(positions, /asIdentifier\(body\.orgUnitId\)/);
  assert.match(positions, /asOptionalText\(body\.jobFamily, 100\)/);
  assert.match(positions, /asOptionalText\(body\.grade, 64\)/);
  assert.match(positions, /asOptionalText\(body\.location, 160\)/);
  assert.match(positions, /asEnumValue\(body\.status \?\? PositionStatus\.OPEN/);
});
