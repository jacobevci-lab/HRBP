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
