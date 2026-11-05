import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync("components/admin-studio.tsx", "utf8");
const page = readFileSync("app/module/admin/page.tsx", "utf8");
const nav = readFileSync("lib/ui-shell-navigation.mjs", "utf8");
const modulePage = readFileSync("app/module/[slug]/page.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Administration primary navigation opens the dedicated Admin Studio", () => {
  assert.match(nav, /id: "admin", slug: "admin", label: "admin"/);
  assert.match(page, /<AppShell><AdminStudio\/><\/AppShell>/);
});

test("Admin Studio cards are capability filtered rather than role-expanded", () => {
  assert.match(studio, /areas\.filter\(\(area\) => can\(ctx, area\.capability\)\)/);
  assert.match(studio, /area\.writeCapability \? can\(ctx, area\.writeCapability\) : false/);
  assert.doesNotMatch(studio, /PlatformRole\./);
});

test("Admin Studio links only to existing governed product surfaces", () => {
  const expected = [
    "/module/settings",
    "/module/workflows?mode=admin",
    "/module/notifications",
    "/module/audit",
    "/module/privacy",
    "/module/policies"
  ];
  for (const href of expected) assert.ok(studio.includes('href: "' + href + '"'), href + " must be declared");
  const declared = [...studio.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(declared)].sort(), [...expected].sort());
});

test("Admin Studio does not collapse downstream read/write authorization", () => {
  assert.match(studio, /capability: "settings:read"/);
  assert.match(studio, /writeCapability: "settings:write"/);
  assert.match(studio, /capability: "workflows:read"/);
  assert.match(studio, /writeCapability: "workflows:write"/);
  assert.match(studio, /capability: "privacy:read"/);
  assert.match(studio, /writeCapability: "privacy:write"/);
  assert.match(modulePage, /slug === "settings"[\s\S]{0,260}can\(ctx, "settings:write"\)/);
  assert.match(modulePage, /workflowAdminVisible = can\(ctx, "workflows:read"\)/);
});

test("Admin Studio communicates that it is navigation, not privilege aggregation", () => {
  assert.match(studio, /Capabilities do not merge here/);
  assert.match(studio, /settings:read does not imply settings:write/);
  assert.match(studio, /Admin Studio is only a navigation layer/);
});

test("Admin Studio follows responsive Warm Enterprise styling", () => {
  for (const selector of [".admin-studio", ".admin-studio-grid", ".admin-studio-card", ".admin-studio-boundary"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
});

test("Access Scope Admin preview keeps readable labels and preview metadata", () => {
  const scopeCss = readFileSync("components/access-scope-admin.module.css", "utf8");
  assert.match(scopeCss, /\.field span\{font-size:10px/);
  assert.match(scopeCss, /\.include,.exclude\{[^}]*font-size:9\.5px/);
  assert.match(scopeCss, /\.previewMetric span,.previewPeople>span\{font-size:9\.5px/);
  assert.match(scopeCss, /\.previewMetric small\{font-size:9\.5px/);
  assert.match(scopeCss, /\.previewPeople em\{font-style:normal;font-size:9\.5px/);
  assert.match(scopeCss, /\.previewWarning\{[^}]*font-size:9\.5px/);
});
