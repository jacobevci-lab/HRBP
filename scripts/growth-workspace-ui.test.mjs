import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modulePage = readFileSync("components/growth-module-page.tsx", "utf8");
const focus = readFileSync("components/growth-workspace-focus.tsx", "utf8");
const live = readFileSync("components/growth-live-workspace.tsx", "utf8");
const performanceOps = readFileSync("components/performance-operations-console.tsx", "utf8");
const talentGovernance = readFileSync("components/talent-governance-console.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Performance and Talent get a cockpit focus layer before deep administration", () => {
  assert.match(modulePage, /focusEnabled = slug === "performance" \|\| slug === "talent"/);
  assert.match(modulePage, /<GrowthWorkspaceFocus/);
  assert.match(modulePage, /id=\{focusEnabled \? "growth-overview" : undefined\}/);
  assert.match(focus, /slug: "performance" \| "talent"/);
  assert.match(focus, /Performance decisions/);
  assert.match(focus, /Talent matrix/);
});

test("participant work stays visible while administration becomes progressive disclosure", () => {
  assert.match(modulePage, /id="growth-participant-actions"/);
  assert.match(modulePage, /Review and goal work assigned to you/);
  assert.match(modulePage, /<details id="growth-governed-admin" className="growth-governed-panel">/);
  assert.match(modulePage, /<details id="growth-governance" className="growth-governed-panel">/);
  assert.match(modulePage, /writeCapability \?\? ""/);
});

test("Performance shortcuts point to existing governed decision and overview surfaces", () => {
  assert.match(focus, /\/module\/workflows\?view=performance/);
  assert.match(focus, /#growth-overview/);
  assert.match(focus, /#growth-participant-actions/);
  assert.match(focus, /#growth-governed-admin/);
});

test("Talent cockpit links assessment evidence to succession and learning without autonomous scoring", () => {
  assert.match(focus, /\/module\/workflows\?view=talent/);
  assert.match(focus, /\/module\/succession/);
  assert.match(focus, /\/module\/learning/);
  assert.match(focus, /Human-reviewed performance × potential; no opaque score/);
  assert.match(live, /label=\{c\(locale,"AI scoring","AI puanlama"\)\} value=\{c\(locale,"Off","Kapalı"\)\}/);
  assert.match(live, /No autonomous employee scoring/);
});

test("existing write and human-decision controls remain in the underlying governed consoles", () => {
  assert.match(modulePage, /writeCapability && can\(ctx, writeCapability\)/);
  assert.match(modulePage, /can\(ctx, "performance:self-submit"\)/);
  assert.match(modulePage, /can\(ctx, "performance:manager-review"\)/);
  assert.match(performanceOps, /performance/);
  assert.match(talentGovernance, /talent/);
});

test("Performance and Talent cockpit uses responsive Warm Enterprise styling", () => {
  for (const selector of [".growth-focus-grid", ".growth-focus-card", ".growth-personal-actions", ".growth-governed-panel"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:620px\)\{\.growth-focus-grid/);
});


test("live Performance and Talent surfaces follow the active EN/TR locale", () => {
  assert.match(live, /getServerLocale/);
  assert.match(live, /const \[ctx, locale\] = await Promise\.all/);
  assert.match(live, /Dönem tamamlanma/);
  assert.match(live, /İnsan sahipliğinde puanlama/);
  assert.match(live, /İnsan değerlendirmeli yetenek matrisi/);
  assert.match(live, /AI ile puanlanmaz/);
  assert.match(live, /localGrowthValue\(locale,goal\.status\)/);
  assert.match(live, /localGrowthValue\(locale,row\.performance\)/);
});
