import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const core = readFileSync("components/core-hr-live-workspace.tsx", "utf8");
const rail = readFileSync("components/employee-360-rail.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Employee 360 keeps the employee context fixed while detail tabs change", () => {
  assert.match(core, /<Employee360Rail/);
  assert.match(core, /<main className="employee-360-main">/);
  assert.match(core, /activeTab=\{activeTab\}/);
  assert.match(core, /tabs=\{tabs\}/);
  assert.match(rail, /className="employee-360-rail card"/);
  assert.match(rail, /employee-360-rail-nav/);
  assert.match(rail, /\/module\/employee-360\?person=/);
});

test("existing compensation and document authorization remains authoritative", () => {
  assert.match(core, /canReadCompensation = !!ctx && can\(ctx, "compensation:read"\)/);
  assert.match(core, /canReadDocuments = !!ctx && can\(ctx, "documents:read"\)/);
  assert.match(core, /activeTab === "compensation" \? canReadCompensation/);
  assert.match(core, /activeTab === "documents" \? canReadDocuments/);
  assert.match(rail, /canReadCompensation/);
  assert.match(rail, /canReadDocuments/);
  assert.doesNotMatch(rail, /compensationHistory|documents\.map|fetch\(/);
});

test("Employee 360 preserves all five governed sections and deep-link query state", () => {
  for (const value of ["overview","employment","compensation","documents","history"]) {
    assert.match(core, new RegExp('value: "' + value + '"'));
  }
  assert.match(rail, /tab=\$\{value\}/);
  assert.match(core, /const activeTab = tab && employeeTabs\.has\(tab\) \? tab : "overview"/);
});

test("Employee 360 rail surfaces identity and access context without privileged data", () => {
  for (const field of ["employeeNumber","position","department","location","manager","workEmail","classification"]) {
    assert.match(rail, new RegExp("person\\." + field));
  }
  assert.match(rail, /Compensation/);
  assert.match(rail, /Documents/);
  assert.match(rail, /Restricted/);
});

test("master-detail layout is sticky on desktop and collapses responsively", () => {
  assert.match(css, /\.employee-360-layout\{display:grid;grid-template-columns:280px minmax\(0,1fr\)/);
  assert.match(css, /\.employee-360-rail\{position:sticky;top:88px/);
  assert.match(css, /@media\(max-width:1040px\)[\s\S]*\.employee-360-layout\{grid-template-columns:1fr\}/);
});
