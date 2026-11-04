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
const globalSearch = readFileSync("components/global-search.tsx", "utf8");
const globalSearchRoute = readFileSync("app/api/search/route.ts", "utf8");

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

test("operational consoles and lifecycle modules keep readable control text", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  const pass = unified.slice(unified.lastIndexOf("/* 2026-11 readability pass 3"));
  assert.ok(pass.length > 2000, "operational readability overrides must remain in the final visual contract");
  for (const rule of [
    ".performance-form label{font-size:10px!important}",
    ".performance-form input,.performance-form select,.performance-form textarea,",
    ".ats-form label{font-size:10px!important}",
    ".onb-plan>header strong,.onb-task-copy strong{font-size:10.5px!important}",
    ".off-create-form label{font-size:10px!important}",
    ".off-task-list strong{font-size:10.5px!important}",
    ".lifecycle-action-panel label{font-size:10px!important}",
    ".lifecycle-action-panel input,.lifecycle-action-panel select{font-size:10.5px!important}",
    ".growth-table th{font-size:10px!important}",
    ".services-table th{font-size:10px!important}",
    ".workpay-table th{font-size:10px!important}"
  ]) assert.ok(pass.includes(rule), rule + " must retain readable operational typography");
});

test("admin audit settings and workflow surfaces keep readable typography", () => {
  const unified = readFileSync("app/warm-enterprise-unified.css", "utf8");
  const pass = unified.slice(unified.lastIndexOf("/* 2026-11 readability pass 4"));
  assert.ok(pass.length > 5000, "admin and workflow readability overrides must remain in the final visual contract");
  for (const rule of [
    ".audit-table th{font-size:10px!important}",
    ".audit-table td,.audit-table td strong{font-size:10.5px!important}",
    ".form-field label{font-size:10px!important}",
    ".settings-live-table th{font-size:10px!important}",
    ".settings-live-table td,.settings-live-table td strong{font-size:10.5px!important}",
    ".connection-lifecycle-table th{font-size:10px!important}",
    ".workflow-action-table th{font-size:10px!important}",
    ".workflow-editor-mode select,.workflow-editor-metadata input,.workflow-editor-metadata textarea,",
    ".workflow-version-summary small,",
    ".workflow-action-result-count{font-size:9.5px!important}"
  ]) assert.ok(pass.includes(rule), rule + " must retain readable admin/workflow typography");
});

test("global search keeps hidden results inert and deep-links position matches", () => {
  assert.match(globalSearch, /event\.key === "Enter" && open/);
  assert.doesNotMatch(globalSearch, /else if \(event\.key === "Enter"\) \{/);
  assert.match(globalSearchRoute, /href: `\/module\/positions\?q=\$\{encodeURIComponent\(position\.positionCode\)\}`/);
});

test("global search reports degraded live-data state before ordinary empty results", () => {
  const degradedIndex = globalSearch.indexOf("if (degraded)");
  const emptyIndex = globalSearch.indexOf("if (!items.length)");
  assert.ok(degradedIndex > -1 && emptyIndex > degradedIndex);
  assert.match(globalSearch, /Live people\/position search is limited; no accessible module matches\./);
  assert.match(globalSearch, /Canlı çalışan\/pozisyon araması sınırlı; erişilebilir modül eşleşmesi yok\./);
});

test("global search groups module people and position results without breaking flat keyboard indices", () => {
  assert.match(globalSearch, /const groupedItems = useMemo/);
  assert.match(globalSearch, /startIndex: index/);
  assert.match(globalSearch, /const index = group\.startIndex \+ localIndex/);
  assert.match(globalSearch, /role="group" aria-label=\{groupLabel\(group\.type\)\}/);
  assert.match(globalSearch, /global-search-group-label/);
  assert.match(globalSearch, /"Modules"/);
  assert.match(globalSearch, /"People"/);
  assert.match(globalSearch, /"Positions"/);
});

test("global search clears stale results before a debounced live query starts", () => {
  const effectStart = globalSearch.indexOf("const normalized = query.trim()");
  const timerIndex = globalSearch.indexOf("const timer = window.setTimeout", effectStart);
  const clearIndex = globalSearch.indexOf("setItems([])", effectStart);
  const loadingIndex = globalSearch.indexOf("setLoading(true)", effectStart);
  assert.ok(effectStart > -1 && clearIndex > effectStart && clearIndex < timerIndex);
  assert.ok(loadingIndex > clearIndex && loadingIndex < timerIndex);
  assert.match(globalSearch.slice(effectStart, timerIndex), /setDegraded\(false\)/);
  assert.match(globalSearch.slice(effectStart, timerIndex), /setActiveIndex\(0\)/);
});

test("global search keeps keyboard selection visible in long result lists", () => {
  assert.match(globalSearch, /const menuRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(globalSearch, /event\.key === "Home" && open/);
  assert.match(globalSearch, /setActiveIndex\(0\)/);
  assert.match(globalSearch, /event\.key === "End" && open/);
  assert.match(globalSearch, /setActiveIndex\(items\.length - 1\)/);
  assert.match(globalSearch, /querySelector<HTMLElement>\(\`#global-search-option-\$\{boundedIndex\}\`\)/);
  assert.match(globalSearch, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(globalSearch, /role="listbox" ref=\{menuRef\} aria-busy=\{loading\}/);
});

test("global search keeps live status outside listbox option ownership", () => {
  const menuIndex = globalSearch.indexOf('<div className="global-search-menu">');
  const statusIndex = globalSearch.indexOf('role="status" aria-live="polite"', menuIndex);
  const listboxIndex = globalSearch.indexOf('className="global-search-options" id="global-search-results" role="listbox"', menuIndex);
  assert.ok(menuIndex > -1 && statusIndex > menuIndex && listboxIndex > statusIndex);
  assert.match(globalSearch, /role="listbox" ref=\{menuRef\} aria-busy=\{loading\}/);
  assert.match(globalSearch, /Home\/End \{locale === "tr" \? "İlk\/son" : "First\/last"\}/);
});

test("global search closes when keyboard focus leaves the search surface", () => {
  assert.match(globalSearch, /onBlur=\{\(event\) => \{/);
  assert.match(globalSearch, /!event\.currentTarget\.contains\(event\.relatedTarget as Node \| null\)/);
  assert.match(globalSearch, /setOpen\(false\)/);
  assert.match(globalSearch, /setActiveIndex\(0\)/);
});

test("global search has explicit focus visibility and readable helper typography", () => {
  const searchCss = readFileSync("app/global-search.css", "utf8");
  assert.match(searchCss, /\.global-search-clear\{width:30px;height:30px/);
  assert.match(searchCss, /\.global-search-clear:focus-visible\{outline:2px solid var\(--accent\)/);
  assert.match(searchCss, /\.global-search-result:focus-visible\{outline:2px solid var\(--accent\)/);
  assert.match(searchCss, /\.global-search-result-copy small\{font-size:9\.5px/);
  assert.match(searchCss, /\.global-search-result em\{[^}]*font-size:9\.5px/);
  assert.match(searchCss, /\.global-search-hints\{[^}]*font-size:9\.5px/);
  assert.match(searchCss, /@media\(prefers-reduced-motion:reduce\)\{\.global-search-root \.global-search\{transition:none\}\}/);
});
