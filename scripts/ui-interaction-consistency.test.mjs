import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/workspace-shell.css", "utf8");
const shell = readFileSync("components/app-shell.tsx", "utf8");
const myWork = readFileSync("components/workflow-action-center.tsx", "utf8");
const employee360 = readFileSync("components/employee-360-rail.tsx", "utf8");
const moduleLanding = readFileSync("components/module-landing.tsx", "utf8");
const publicModule = readFileSync("components/public-module-landing.tsx", "utf8");
const coreWorkspace = readFileSync("components/core-hr-live-workspace.tsx", "utf8");
const growthModule = readFileSync("components/growth-module-page.tsx", "utf8");
const workPayModule = readFileSync("components/work-pay-module-page.tsx", "utf8");
const governanceModule = readFileSync("components/governance-planning-module-page.tsx", "utf8");

test("all major cockpit links receive a visible keyboard focus treatment", () => {
  for (const selector of [
    ".workspace-shortcut",
    ".manager-hub-action",
    ".operations-attention-card",
    ".employee-home-action",
    ".admin-studio-card",
    ".growth-focus-card",
    ".recruiting-focus-card",
    ".compensation-focus-card",
    ".offboarding-focus-card",
    ".services-focus-card",
    ".employee-360-rail-nav a"
  ]) assert.ok(css.includes(selector), selector + " must participate in cross-product focus styling");
  assert.match(css, /:focus-visible\{/);
  assert.match(css, /outline:2px solid/);
});

test("progressive-disclosure summaries remain keyboard focusable and visibly outlined", () => {
  for (const selector of [
    ".nav-disclosure>summary",
    ".my-work-source-panel>summary",
    ".my-work-history-panel>summary",
    ".recruiting-operations-panel>summary",
    ".compensation-proposal-panel>summary",
    ".growth-governed-panel>summary",
    ".onboarding-operations-panel>summary",
    ".offboarding-operations-panel>summary",
    ".service-governance-panel>summary",
    ".service-admin-panel>summary"
  ]) assert.ok(css.includes(selector), selector + " must have summary focus styling");
  assert.match(shell, /<summary>/);
  assert.match(myWork, /<summary>/);
});

test("mobile interaction targets remain usable across persona and cockpit cards", () => {
  assert.match(css, /@media\(max-width:620px\)[\s\S]*min-height:72px/);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*min-height:44px/);
});

test("reduced-motion preference disables nonessential cockpit transitions", () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /transition:none!important/);
  assert.match(css, /scroll-behavior:auto!important/);
});

test("wide data surfaces contain horizontal overscroll rather than forcing page overflow", () => {
  assert.match(css, /\.table-wrap,.growth-table-wrap,.services-table-wrap,.off-table-wrap\{overscroll-behavior-inline:contain\}/);
  assert.match(css, /\.enterprise-table-card,.growth-panel,.services-panel,.off-panel\{min-width:0\}/);
});

test("Employee 360 section navigation remains semantic navigation rather than click-only divs", () => {
  assert.match(employee360, /<nav className="employee-360-rail-nav"/);
  assert.match(employee360, /<Link key=\{tab\.value\}/);
});


test("module state indicators are semantic text badges rather than disabled fake actions", () => {
  for (const source of [moduleLanding, publicModule, coreWorkspace, growthModule, workPayModule, governanceModule]) {
    assert.doesNotMatch(source, /<button className="secondary-button" disabled>/);
  }
  assert.match(moduleLanding, /module-state-badge/);
  assert.match(publicModule, /module-state-badge/);
  assert.match(coreWorkspace, /Current hierarchy/);
  assert.ok((growthModule.match(/module-state-badge/g) ?? []).length >= 3);
  assert.ok((workPayModule.match(/module-state-badge/g) ?? []).length >= 3);
  assert.ok((governanceModule.match(/module-state-badge/g) ?? []).length >= 3);
  assert.match(css, /\.module-state-badge\{cursor:default!important;user-select:none;pointer-events:none\}/);
});


test("Warm Enterprise visual overhaul establishes a visibly different shell and cockpit hierarchy", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  for (const marker of [
    "--shell-sidebar:244px",
    "--panel-radius:16px",
    ".page-heading.module-heading",
    ".enterprise-view-toolbar",
    ".enterprise-table-card",
    ".operations-attention-card",
    ".employee-home-hero"
  ]) assert.ok(unified.includes(marker), marker + " must remain part of the visual overhaul contract");
  assert.match(unified, /\.page-heading\.module-heading[\s\S]*border-radius:18px/);
  assert.match(unified, /\.enterprise-stat[^]*min-height:104px/);
  assert.match(unified, /\.enterprise-table td[^]*font-size:11\.5px/);
  assert.match(unified, /@media\(max-width:620px\)[^]*\.page-heading\.module-heading/);
});


test("detail workspaces keep the upgraded master-detail visual hierarchy", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  assert.match(unified, /\.employee-360-layout\{[^]*grid-template-columns:300px/);
  assert.match(unified, /\.employee-360-rail\{[^]*border-radius:18px/);
  assert.match(unified, /\.growth-split,.growth-grid,.services-split\{[^]*1\.7fr/);
  assert.match(unified, /\.services-table tbody tr\.focused td/);
});


test("shell offers skip navigation and active links expose current-page semantics", () => {
  assert.match(shell, /className="skip-link" href="#main-content"/);
  assert.match(shell, /id="main-content" tabIndex=\{-1\}/);
  assert.ok((shell.match(/aria-current=\{active \? "page" : undefined\}/g) ?? []).length >= 2);
  assert.match(shell, /aria-label=\{t\("shell\.primaryNavigation"\)\}/);
  assert.match(css, /\.skip-link\{/);
  assert.match(css, /\.skip-link:focus\{/);
});

test("enterprise keyboard surfaces use semantic disabled and live-state behavior", () => {
  const search = readFileSync("components/global-search.tsx", "utf8");
  const pager = readFileSync("components/enterprise-pagination.tsx", "utf8");
  const bulk = readFileSync("components/position-bulk-action-form.tsx", "utf8");
  assert.match(search, /aria-haspopup="listbox"/);
  assert.match(search, /setActiveIndex\(0\)/);
  assert.ok((pager.match(/<span className="enterprise-page-button disabled" aria-disabled="true">/g) ?? []).length >= 2);
  assert.doesNotMatch(pager, /tabIndex=\{page <= 1/);
  assert.match(bulk, /<strong aria-live="polite">/);
});


test("enterprise visual system keeps readable minimum typography at normal and compact density", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  assert.match(unified, /\.enterprise-table th[^]*font-size:10px/);
  assert.match(unified, /\.enterprise-table td[^]*font-size:11\.5px/);
  assert.match(unified, /\.enterprise-density-compact \.enterprise-table th[^]*font-size:9\.5px/);
  assert.match(unified, /\.enterprise-density-compact \.enterprise-table td[^]*font-size:10px/);
  assert.match(unified, /\.enterprise-view-search input\{font-size:11\.5px/);
  assert.match(unified, /\.employee-360-rail-nav a\{[^]*font-size:10\.5px/);
  assert.match(unified, /\.enterprise-page-button,.enterprise-page-number\{[^]*font-size:10\.5px/);
});


test("cockpit cards and KPI helper text stay above the previous microtype scale", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  assert.match(unified, /\.manager-hub-action strong[^]*font-size:11\.5px/);
  assert.match(unified, /\.manager-hub-action small[^]*font-size:10px/);
  assert.match(unified, /\.enterprise-stat span[^]*font-size:10\.5px/);
  assert.match(unified, /\.enterprise-stat small[^]*font-size:9\.5px/);
});

test("primary workflow secondary copy no longer falls back to 7–9px microtype", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  const pass = unified.slice(unified.lastIndexOf("/* 2026-11 readability pass 2"));
  assert.ok(pass.length > 1000, "second readability pass must remain loaded after legacy module CSS");
  for (const rule of [
    ".metric-meta{font-size:10px!important}",
    ".card-header p{font-size:10px!important}",
    ".attention-row small{font-size:10px!important}",
    ".my-work-source-panel>summary>small,.my-work-history-panel>summary small{font-size:9.5px!important}",
    ".operations-lane>a>small{font-size:10px!important}",
    ".employee-home-balance-list small,.employee-home-next small,.employee-home-next span,.employee-home-learning-list small{font-size:9.5px!important}",
    ".employee-360-rail-nav small{font-size:9.5px!important}",
    ".employee-360-access small{font-size:9.5px!important}",
    ".growth-section-head p{font-size:10px!important}",
    ".pipeline-column article small,.pipeline-column article em{font-size:9.5px!important}",
    ".journey-person small,.journey-owner small,.journey-progress small,.journey-list em{font-size:9.5px!important}",
    ".task-control-list small,.task-control-list b,.onboarding-policy p{font-size:9.5px!important}"
  ]) assert.ok(pass.includes(rule), rule + " must retain readable workflow microcopy");
});
