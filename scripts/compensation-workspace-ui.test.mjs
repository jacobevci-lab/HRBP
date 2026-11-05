import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync("components/compensation-live-workspace.tsx", "utf8");
const data = readFileSync("lib/compensation-live-data.ts", "utf8");
const decisions = readFileSync("components/compensation-decision-buttons.tsx", "utf8");
const create = readFileSync("components/compensation-create-console.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Compensation starts with decisions and context rather than an always-open proposal form", () => {
  assert.match(workspace, /className="compensation-focus-grid"/);
  assert.match(workspace, /id="compensation-change-queue"/);
  assert.match(workspace, /<details className="compensation-proposal-panel">/);
  assert.match(workspace, /Create compensation proposal/);
  assert.match(workspace, /Employee context/);
});

test("approval and payroll paths are capability-aware", () => {
  assert.match(workspace, /canApprove \|\| canApply/);
  assert.match(workspace, /\/module\/workflows\?view=compensation/);
  assert.match(workspace, /canReadPayroll = can\(ctx, "payroll:read"\)/);
  assert.match(workspace, /canReadPayroll \? <Link href="\/module\/payroll"/);
});

test("existing compensation security separation remains intact", () => {
  assert.match(workspace, /canPropose = can\(ctx, "compensation:propose"\)/);
  assert.match(workspace, /canApprove = can\(ctx, "compensation:approve"\)/);
  assert.match(workspace, /canApply = can\(ctx, "compensation:apply"\)/);
  assert.match(workspace, /isRequester=\{row\.requestedById === ctx\.actorId\}/);
  assert.match(decisions, /canApprove/);
  assert.match(decisions, /canApply/);
  assert.match(create, /\/api\/compensation\/changes/);
});

test("compensation data remains relationship scoped", () => {
  assert.match(data, /resolveEmploymentScope\(db, ctx\)/);
  assert.match(data, /employmentIdFilter\(scope\)/);
  assert.match(data, /employmentPrimaryKeyFilter\(scope\)/);
  assert.match(data, /tenantId: ctx\.tenantId/);
});

test("Compensation cockpit follows responsive Warm Enterprise styling", () => {
  for (const selector of [".compensation-focus-grid", ".compensation-focus-card", ".compensation-proposal-panel", ".compensation-proposal-body"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:620px\)\{\.compensation-focus-grid/);
});
