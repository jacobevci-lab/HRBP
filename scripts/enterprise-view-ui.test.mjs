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
  assert.match(toolbar, /name="pageSize"/);
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
  assert.match(workspace, /getPeopleWorkspaceData\(currentView\.query, tenantId, currentView\.status, currentView\.sortKey, currentView\.sortDirection, page, currentView\.pageSize\)/);
  assert.match(workspace, /getPositionsWorkspaceData\(currentView\.query, tenantId, currentView\.status, currentView\.sortKey, currentView\.sortDirection, page, currentView\.pageSize\)/);
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
  assert.match(modulePage, /search\.page === "string"/);
  assert.match(modulePage, /search\.pageSize === "string"/);
  assert.match(moduleLanding, /columns\?: string\[\]/);
  assert.match(moduleLanding, /density\?: "comfortable" \| "compact"/);
  assert.match(moduleLanding, /sortKey\?: string/);
  assert.match(moduleLanding, /sortDirection\?: "asc" \| "desc"/);
  assert.match(moduleLanding, /page\?: number/);
  assert.match(moduleLanding, /pageSize\?: 25 \| 50 \| 100/);
  assert.match(moduleLanding, /CoreHRLiveWorkspace\(\{ slug, query, status, columns, columnsCustomized, density, sortKey, sortDirection, page, pageSize, personId, tab \}\)/);
});

test("enterprise view controls are responsive Warm Enterprise surfaces", () => {
  for (const selector of [".enterprise-view-toolbar", ".enterprise-view-controls", ".enterprise-view-search", ".enterprise-view-filter", ".enterprise-view-density", ".enterprise-view-page-size", ".enterprise-view-sort", ".enterprise-column-picker", ".enterprise-column-options", ".enterprise-saved-views", ".enterprise-saved-view-popover", ".enterprise-view-count", ".enterprise-pagination"]) {
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


test("enterprise registers use real server-side pagination rather than hard row caps", () => {
  assert.match(data, /normalizeEnterprisePage\(page\)/);
  assert.match(data, /normalizeEnterprisePageSize\(pageSize\)/);
  assert.ok((data.match(/skip,/g) ?? []).length >= 2);
  assert.ok((data.match(/take: normalizedPageSize/g) ?? []).length >= 2);
  assert.ok((data.match(/pageCount = Math\.max\(1, Math\.ceil\(filteredTotal \/ normalizedPageSize\)\)/g) ?? []).length >= 2);
  const peopleBody = data.slice(data.indexOf("export async function getPeopleWorkspaceData"), data.indexOf("export type OrganizationRow"));
  const positionsBody = data.slice(data.indexOf("export async function getPositionsWorkspaceData"), data.indexOf("const employee360Select"));
  assert.doesNotMatch(peopleBody, /take: 250/);
  assert.doesNotMatch(positionsBody, /take: 500/);
  assert.ok((workspace.match(/<EnterprisePagination/g) ?? []).length >= 2);
  assert.match(workspace, /page=\{data\.page\}/);
  assert.match(workspace, /pageCount=\{data\.pageCount\}/);
});

test("People and Positions expose scoped filtered CSV exports", () => {
  const route = readFileSync("app/api/core-hr/export/route.ts", "utf8");
  assert.match(toolbar, /Download/);
  assert.match(toolbar, /new URLSearchParams\(\{ module: moduleKey, locale \}\)/);
  assert.match(toolbar, /columnsMode/);
  assert.match(toolbar, /columns\.forEach\(\(column\) => exportParams\.append\("columns", column\)\)/);
  assert.match(toolbar, /exportEnabled = false/);
  assert.match(toolbar, /exportEnabled \? <a className="secondary-button enterprise-view-export"/);
  assert.ok((workspace.match(/exportEnabled=\{!!ctx\}/g) ?? []).length >= 2);
  assert.match(route, /can\(ctx, "people:read"\)/);
  assert.match(route, /can\(ctx, "positions:read"\)/);
  assert.match(route, /tenantId: ctx\.tenantId/);
  assert.match(route, /resolveEmploymentScope\(db, ctx\)/);
  assert.match(route, /employmentPrimaryKeyFilter\(peopleScope\)/);
  assert.match(route, /take: EXPORT_LIMIT \+ 1/);
  assert.match(route, /status: 422/);
  assert.match(route, /\^\[=\+\\-@\]/);
  assert.match(route, /PEOPLE_REGISTER_EXPORTED/);
  assert.match(route, /POSITIONS_REGISTER_EXPORTED/);
  assert.match(route, /DataClassification\.CONFIDENTIAL/);
  assert.match(route, /cache-control": "no-store"/);
  assert.match(route, /x-content-type-options": "nosniff"/);
  assert.match(unified, /\.enterprise-view-export\{/);
});

test("People and Positions distinguish empty registers from empty filtered results", () => {
  assert.match(workspace, /const peopleFiltered = Boolean\(currentView\.query \|\| currentView\.status\)/);
  assert.match(workspace, /No people match the current filters\./);
  assert.match(workspace, /No people records are available\./);
  assert.match(workspace, /actionHref=\{peopleFiltered \? "\/module\/people" : undefined\}/);
  assert.match(workspace, /const positionsFiltered = Boolean\(currentView\.query \|\| currentView\.status\)/);
  assert.match(workspace, /No positions match the current filters\./);
  assert.match(workspace, /No positions are configured\./);
  assert.match(workspace, /actionHref=\{positionsFiltered \? "\/module\/positions" : undefined\}/);
  assert.match(unified, /\.enterprise-empty-row\{/);
});

test("People and Positions support URL-native sortable table headers", () => {
  assert.match(workspace, /buildEnterpriseViewHref/);
  assert.doesNotMatch(workspace, /function enterpriseSortHref/);
  assert.match(workspace, /const active = state\.sortKey === sortKey \|\| \(!state\.sortKey && defaultActive\)/);
  assert.match(workspace, /const currentDirection = active \? state\.sortDirection : "asc"/);
  assert.match(workspace, /sortDirection: active && currentDirection === "asc" \? "desc" : "asc"/);
  assert.match(workspace, /aria-sort=\{ariaSort\}/);
  assert.match(workspace, /moduleKey="people" state=\{currentView\} sortKey="name"[^>]*defaultActive/);
  assert.match(workspace, /moduleKey="positions" state=\{currentView\} sortKey="title"/);
  assert.match(workspace, /sortKey="status"/);
  assert.match(workspace, /sortKey="critical"/);
  assert.match(unified, /\.enterprise-sort-header\{/);
  assert.match(unified, /\.enterprise-sort-header:focus-visible/);
});
