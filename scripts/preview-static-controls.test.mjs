import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "components/core-hr-workspace.tsx",
  "components/employee-services-workspace.tsx",
  "components/growth-workspace.tsx",
  "components/work-pay-workspace.tsx"
];

test("synthetic preview workspaces expose no inert button elements", () => {
  let totalStatic = 0;
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /<button\b/, path + " must not render fake preview buttons");
    assert.doesNotMatch(source, /previewActionProps/, path + " must not retain disabled-button helper");
    totalStatic += (source.match(/preview-static-/g) ?? []).length;
  }
  assert.equal(totalStatic, 26, "all 26 historical preview button candidates must be static affordances");
});

test("preview controls distinguish labels, tabs and decorative icon affordances", () => {
  const core = readFileSync("components/core-hr-workspace.tsx", "utf8");
  assert.match(core, /preview-static-label/);
  assert.match(core, /preview-static-tab active/);
  assert.match(core, /preview-static-icon/);
  assert.match(core, /aria-hidden="true"/);
});

test("static preview affordances do not look or behave like actionable primary controls", () => {
  const css = readFileSync("app/workspace-shell.css", "utf8");
  assert.match(css, /\.preview-static-label\{/);
  assert.match(css, /cursor:default/);
  assert.match(css, /user-select:none/);
  assert.match(css, /\.profile-tabs \.preview-static-tab\.active/);
  assert.doesNotMatch(css, /\.preview-static-label[^}]*cursor:pointer/);
});
