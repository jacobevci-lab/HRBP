import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync("components/recruiting-workspace.tsx", "utf8");
const access = readFileSync("lib/recruiting-access.ts", "utf8");
const operations = readFileSync("components/recruiting-operations-console.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Recruiting starts as a hiring cockpit rather than an always-open write console", () => {
  assert.match(workspace, /className="recruiting-focus-grid"/);
  assert.match(workspace, /className="recruiting-operations-panel"/);
  assert.match(workspace, /<details className="recruiting-operations-panel">/);
  assert.match(workspace, /Authorized write tools/);
  assert.match(workspace, /id="candidate-pipeline"/);
  assert.match(workspace, /id="requisitions"/);
});

test("hiring decisions and onboarding handoff are first-class governed paths", () => {
  assert.ok((workspace.match(/\/module\/workflows\?view=recruiting/g) ?? []).length >= 2);
  assert.match(workspace, /href="\/module\/onboarding"/);
  assert.match(workspace, /Hire → onboarding/);
});

test("write tools remain conditional on recruiting write capability", () => {
  assert.match(workspace, /if \(can\(ctx, "recruiting:write"\)\)/);
  assert.match(workspace, /operations \? <details className="recruiting-operations-panel"/);
  assert.match(workspace, /canApprove=\{can\(ctx, "recruiting:approve"\)\}/);
  assert.match(operations, /\/api\/recruiting\/requisitions/);
  assert.match(operations, /\/api\/recruiting\/candidates/);
  assert.match(operations, /\/api\/recruiting\/applications/);
  assert.match(operations, /\/api\/recruiting\/offers/);
});

test("candidate and requisition read scope remains enforced by existing access filters", () => {
  assert.match(access, /recruitingRequisitionReadFilter/);
  assert.match(access, /recruitingApplicationReadFilter/);
  assert.match(workspace, /getRecruitingWorkspaceData\(ctx\)/);
  assert.match(workspace, /Managers see candidate records only for requisitions they own/);
});

test("Recruiting cockpit follows responsive Warm Enterprise styling", () => {
  for (const selector of [".recruiting-focus-grid", ".recruiting-focus-card", ".recruiting-operations-panel", ".recruiting-operations-body"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:620px\)\{\.recruiting-focus-grid/);
});
