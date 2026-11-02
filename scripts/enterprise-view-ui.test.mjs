import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolbar = readFileSync("components/enterprise-view-toolbar.tsx", "utf8");
const workspace = readFileSync("components/core-hr-live-workspace.tsx", "utf8");
const data = readFileSync("lib/core-hr-live-data.ts", "utf8");
const moduleLanding = readFileSync("components/module-landing.tsx", "utf8");
const modulePage = readFileSync("app/module/[slug]/page.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("shared enterprise toolbar uses URL-native query and status filters", () => {
  assert.match(toolbar, /<form className="enterprise-view-toolbar" action=\{basePath\} method="get">/);
  assert.match(toolbar, /name="q"/);
  assert.match(toolbar, /maxLength=\{160\}/);
  assert.match(toolbar, /name="status"/);
  assert.match(toolbar, /href=\{basePath\}/);
  assert.match(toolbar, /shownCount/);
  assert.match(toolbar, /totalCount/);
});

test("People and Positions use the same governed table controls", () => {
  assert.ok((workspace.match(/<EnterpriseViewToolbar/g) ?? []).length >= 2);
  assert.match(workspace, /basePath="\/module\/people"/);
  assert.match(workspace, /basePath="\/module\/positions"/);
  assert.match(workspace, /getPeopleWorkspaceData\(query, tenantId, status\)/);
  assert.match(workspace, /getPositionsWorkspaceData\(query, tenantId, status\)/);
});

test("status filters are allowlisted and relationship scope remains part of database predicates", () => {
  assert.match(data, /normalizedEmploymentStatus/);
  assert.match(data, /EmploymentStatus\.ACTIVE/);
  assert.match(data, /EmploymentStatus\.PREBOARDING/);
  assert.match(data, /EmploymentStatus\.LEAVE/);
  assert.match(data, /normalizedPositionStatus/);
  for (const value of ["OPEN","PLANNED","FILLED","FROZEN","CLOSED"]) {
    assert.match(data, new RegExp("PositionStatus\\." + value));
  }
  assert.match(data, /employmentPrimaryKeyFilter\(scope\)/);
  assert.match(data, /tenantId: tenant\.id/);
  assert.match(data, /query\.trim\(\)\.slice\(0, 160\)/);
});

test("filtered totals are server-derived and route filter input is bounded", () => {
  assert.ok((data.match(/filteredTotal/g) ?? []).length >= 8);
  assert.match(data, /db\.person\.count\(\{ where \}\)/);
  assert.match(data, /db\.position\.count\(\{ where \}\)/);
  assert.match(modulePage, /search\.status === "string" \? search\.status\.slice\(0, 40\)/);
  assert.match(moduleLanding, /status\?: string/);
  assert.match(moduleLanding, /CoreHRLiveWorkspace\(\{ slug, query, status, personId, tab \}\)/);
});

test("enterprise view controls are responsive Warm Enterprise surfaces", () => {
  for (const selector of [".enterprise-view-toolbar", ".enterprise-view-search", ".enterprise-view-filter", ".enterprise-view-count"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
});
