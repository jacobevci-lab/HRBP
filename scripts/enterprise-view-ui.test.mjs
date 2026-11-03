import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolbar = readFileSync("components/enterprise-view-toolbar.tsx", "utf8");
const workspace = readFileSync("components/core-hr-live-workspace.tsx", "utf8");
const data = readFileSync("lib/core-hr-live-data.ts", "utf8");
const moduleLanding = readFileSync("components/module-landing.tsx", "utf8");
const modulePage = readFileSync("app/module/[slug]/page.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");
const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");

test("shared enterprise toolbar uses URL-native query and status filters", () => {
  assert.match(toolbar, /<div className="enterprise-view-toolbar">/);
  assert.match(toolbar, /<form className="enterprise-view-controls" action=\{basePath\} method="get">/);
  assert.match(toolbar, /name="q"/);
  assert.match(toolbar, /maxLength=\{160\}/);
  assert.match(toolbar, /name="status"/);
  assert.match(toolbar, /name="columnsMode" value="custom"/);
  assert.match(toolbar, /name="columns"/);
  assert.match(toolbar, /enterprise-column-picker/);
  assert.match(toolbar, /name="density"/);
  assert.match(toolbar, /name="sort"/);
  assert.match(toolbar, /name="dir"/);
  assert.match(toolbar, /value="comfortable"/);
  assert.match(toolbar, /value="compact"/);
  assert.match(toolbar, /<EnterpriseSavedViews/);
  assert.match(toolbar, /savedViews=\{savedViews\}/);
  assert.match(toolbar, /href=\{basePath\}/);
  assert.match(toolbar, /shownCount/);
  assert.match(toolbar, /totalCount/);
});

test("People and Positions use the same governed table controls", () => {
  assert.ok((workspace.match(/<EnterpriseViewToolbar/g) ?? []).length >= 2);
  assert.match(workspace, /moduleKey="people"/);
  assert.match(workspace, /moduleKey="positions"/);
  assert.match(workspace, /basePath="\/module\/people"/);
  assert.match(workspace, /basePath="\/module\/positions"/);
  assert.match(workspace, /listSavedEnterpriseViews\(ctx, "people"\)/);
  assert.match(workspace, /listSavedEnterpriseViews\(ctx, "positions"\)/);
  assert.match(workspace, /sanitizeEnterpriseViewState\("people"/);
  assert.match(workspace, /sanitizeEnterpriseViewState\("positions"/);
  assert.match(workspace, /getPeopleWorkspaceData\(currentView\.query, tenantId, currentView\.status, currentView\.sortKey, currentView\.sortDirection\)/);
  assert.match(workspace, /getPositionsWorkspaceData\(currentView\.query, tenantId, currentView\.status, currentView\.sortKey, currentView\.sortDirection\)/);
  assert.match(workspace, /peopleSortOptions/);
  assert.match(workspace, /positionSortOptions/);
  assert.match(workspace, /peopleColumnOptions/);
  assert.match(workspace, /positionColumnOptions/);
  assert.match(workspace, /visiblePeopleColumns\.has\("position"\)/);
  assert.match(workspace, /visiblePositionColumns\.has\("organization"\)/);
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
  assert.match(modulePage, /Array\.isArray\(search\.columns\)/);
  assert.match(modulePage, /rawColumns\.slice\(0, 12\)/);
  assert.match(modulePage, /search\.columnsMode === "custom"/);
  assert.match(modulePage, /search\.density === "compact"/);
  assert.match(modulePage, /search\.sort === "string"/);
  assert.match(modulePage, /search\.dir === "desc"/);
  assert.match(moduleLanding, /columns\?: string\[\]/);
  assert.match(moduleLanding, /density\?: "comfortable" \| "compact"/);
  assert.match(moduleLanding, /sortKey\?: string/);
  assert.match(moduleLanding, /sortDirection\?: "asc" \| "desc"/);
  assert.match(moduleLanding, /CoreHRLiveWorkspace\(\{ slug, query, status, columns, columnsCustomized, density, sortKey, sortDirection, personId, tab \}\)/);
});

test("enterprise view controls are responsive Warm Enterprise surfaces", () => {
  for (const selector of [".enterprise-view-toolbar", ".enterprise-view-controls", ".enterprise-view-search", ".enterprise-view-filter", ".enterprise-view-density", ".enterprise-view-sort", ".enterprise-column-picker", ".enterprise-column-options", ".enterprise-saved-views", ".enterprise-saved-view-popover", ".enterprise-view-count"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
});


test("compact density is URL-native, persisted by the workspace and uses sticky enterprise headers", () => {
  assert.ok((workspace.match(/density=\{currentView\.density\}/g) ?? []).length >= 2);
  assert.ok((workspace.match(/enterprise-density-\$\{currentView\.density\}/g) ?? []).length >= 2);
  assert.match(unified, /\.enterprise-table-card \.enterprise-table thead th/);
  assert.match(unified, /position:sticky/);
  assert.match(unified, /\.enterprise-density-compact \.enterprise-table td/);
});


test("enterprise sorting is allowlisted in UI and executed in PostgreSQL queries", () => {
  assert.match(data, /function peopleOrderBy/);
  assert.match(data, /sortKey === "employeeNumber"/);
  assert.match(data, /function positionOrderBy/);
  for (const key of ["title","status","critical"]) assert.match(data, new RegExp('sortKey === "' + key + '"'));
  assert.match(data, /orderBy: peopleOrderBy\(sortKey, sortDirection\)/);
  assert.match(data, /orderBy: positionOrderBy\(sortKey, sortDirection\)/);
  assert.doesNotMatch(toolbar, /\.sort\(/);
});
