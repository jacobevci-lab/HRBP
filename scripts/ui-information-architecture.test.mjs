import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync("components/app-shell.tsx", "utf8");
const dashboard = readFileSync("components/dashboard.tsx", "utf8");
const modulePage = readFileSync("app/module/[slug]/page.tsx", "utf8");
const myWork = readFileSync("components/workflow-action-center.tsx", "utf8");
const shortcuts = readFileSync("components/dashboard-workspace-shortcuts.tsx", "utf8");
const i18n = readFileSync("lib/i18n.ts", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("shell separates quick work destinations from the product catalog", () => {
  assert.match(shell, /primaryShellDestinations/);
  assert.match(shell, /className="nav-primary"/);
  assert.match(shell, /shell\.quickAccess/);
  assert.match(shell, /shell\.productAreas/);
  assert.match(shell, /item\.slug !== "dashboard"/);
  assert.match(shell, /<details className="nav-group nav-disclosure"/);
  assert.match(shell, /open=\{groupActive \? true : undefined\}/);
});

test("primary navigation remains capability-aware and public staging does not gain privileged shortcuts", () => {
  assert.match(shell, /authenticated,/);
  assert.match(shell, /capabilities: \[\.\.\.navigationCapabilities\]/);
  assert.match(shell, /session\?\.user\?\.role/);
  assert.match(shell, /if \(!authenticated\) return true/);
});

test("dashboard renders role-prioritized workspaces before generic workforce panels", () => {
  const shortcutIndex = dashboard.indexOf("<DashboardWorkspaceShortcuts");
  const metricIndex = dashboard.indexOf('<section className="metrics-grid">');
  assert.ok(shortcutIndex > 0 && metricIndex > shortcutIndex);
  assert.match(shortcuts, /roleWorkspacePreferences/);
  assert.match(shortcuts, /can\(ctx, item\.requiredCapability\)/);
  for (const role of ["EMPLOYEE","MANAGER","HRBP","HR_OPERATIONS","TENANT_ADMIN"]) {
    assert.match(shortcuts, new RegExp('role === "' + role + '"'));
  }
});

test("My Work is the default workflow experience and administration is explicitly separated", () => {
  assert.match(modulePage, /workflowAdminMode = workflowAdminVisible && lifecycleMode === "admin"/);
  assert.match(modulePage, /showAdministrationLink=\{workflowAdminVisible\}/);
  assert.match(modulePage, /<details className="my-work-history-panel">/);
  assert.match(modulePage, /<ModuleLanding slug="workflows" query=\{query\} tab="admin"\/>/);
  assert.match(myWork, /My Work/);
  assert.match(myWork, /What needs your attention now\?/);
  assert.match(myWork, /className="my-work-source-panel"/);
  assert.match(myWork, /open=\{domainFilterActive \? true : undefined\}/);
  assert.match(myWork, /href="\/module\/workflows\?mode=admin"/);
});

test("shell labels are localized and the synthetic dashboard brief is not presented as AI-generated", () => {
  for (const key of ["shell.quickAccess","shell.productAreas","shell.myWork","shell.operations","shell.myTeam","shell.myProfile","shell.insights","shell.administration"]) {
    assert.equal(i18n.split('"' + key + '"').length - 1, 2, key + " must exist in EN and TR");
  }
  assert.match(i18n, /"dashboard\.aiMorningBrief": "Today's focus"/);
  assert.match(i18n, /"dashboard\.aiMorningBrief": "Bugünün odağı"/);
});

test("new navigation and shortcut styling is responsive and loaded before the final theme contract", () => {
  for (const selector of [".nav-primary", ".nav-disclosure", ".workspace-shortcuts", ".workspace-shortcut", ".my-work-source-panel", ".my-work-history-panel"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:520px\)/);
  const shellCss = layout.indexOf('./workspace-shell.css');
  const unified = layout.indexOf('./warm-enterprise-unified.css');
  assert.ok(shellCss > -1 && unified > shellCss);
});

test("production prebuild keeps UI information architecture validation mandatory", () => {
  assert.equal(pkg.scripts["ui-shell:validate"],
    "node --test scripts/ui-shell-navigation.test.mjs scripts/ui-information-architecture.test.mjs scripts/manager-hub-ui.test.mjs scripts/hr-operations-hub-ui.test.mjs scripts/employee-home-ui.test.mjs scripts/enterprise-view-ui.test.mjs scripts/admin-studio-ui.test.mjs scripts/employee-360-ui.test.mjs scripts/recruiting-workspace-ui.test.mjs scripts/compensation-workspace-ui.test.mjs scripts/growth-workspace-ui.test.mjs scripts/lifecycle-workspaces-ui.test.mjs scripts/service-case-workspaces-ui.test.mjs scripts/ui-interaction-consistency.test.mjs scripts/preview-static-controls.test.mjs");
  assert.ok(pkg.scripts.prebuild.split(" && ").includes("npm run ui-shell:validate"));
});


test("dashboard uses the new command-center visual hierarchy and semantic state badges", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  assert.match(dashboard, /className="page-heading dashboard-command-heading"/);
  assert.match(dashboard, /className="ai-brief dashboard-focus-brief"/);
  assert.doesNotMatch(dashboard, /<button className="secondary-button" disabled>/);
  assert.match(dashboard, /module-state-badge/);
  for (const selector of [".dashboard-command-heading", ".dashboard-focus-brief", ".metric-card"]) {
    assert.match(unified, new RegExp(selector.replace(".", "\\.")));
  }
});
