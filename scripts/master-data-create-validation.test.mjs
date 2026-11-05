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
const employeeForm = readFileSync("components/employee-create-form.tsx", "utf8");
const positionForm = readFileSync("components/position-create-form.tsx", "utf8");

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


test("create forms mirror server field bounds and expose accessible pending/error state", () => {
  assert.match(employeeForm, /name="employeeNumber" required maxLength=\{64\}/);
  assert.match(employeeForm, /name="givenName" required maxLength=\{100\}/);
  assert.match(employeeForm, /name="familyName" required maxLength=\{100\}/);
  assert.match(employeeForm, /name="workEmail" required maxLength=\{254\}/);
  assert.match(employeeForm, /className="record-form" onSubmit=\{submit\} aria-busy=\{submitting\}/);
  assert.match(employeeForm, /className="form-error" role="alert"/);
  assert.match(positionForm, /name="positionCode" required maxLength=\{64\}/);
  assert.match(positionForm, /name="title" required maxLength=\{160\}/);
  assert.match(positionForm, /name="jobFamily" maxLength=\{100\}/);
  assert.match(positionForm, /name="grade" maxLength=\{64\}/);
  assert.match(positionForm, /name="location" maxLength=\{160\}/);
  assert.match(positionForm, /No active organization units are available/);
  assert.match(positionForm, /aria-busy=\{submitting\}/);
});


test("create forms use synchronous in-flight locks against same-render duplicate submit", () => {
  for (const [name, source] of [["employee", employeeForm], ["position", positionForm]]) {
    assert.match(source, /import \{ FormEvent, useRef, useState \} from "react"/, name + " form must import useRef");
    assert.match(source, /const submissionLock = useRef\(false\)/, name + " form must allocate an in-flight ref");
    const submitIndex = source.indexOf("async function submit");
    const guardIndex = source.indexOf("if (submissionLock.current) return;", submitIndex);
    const lockIndex = source.indexOf("submissionLock.current = true;", guardIndex);
    const fetchIndex = source.indexOf("fetch(", lockIndex);
    const unlockIndex = source.indexOf("submissionLock.current = false;", fetchIndex);
    assert.ok(submitIndex > -1 && guardIndex > submitIndex, name + " guard must run inside submit");
    assert.ok(lockIndex > guardIndex && fetchIndex > lockIndex, name + " lock must be acquired before fetch");
    assert.ok(unlockIndex > fetchIndex, name + " lock must release only after request completion");
  }
});
