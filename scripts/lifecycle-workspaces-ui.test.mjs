import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const recruiting = readFileSync("components/recruiting-workspace.tsx", "utf8");
const onboardingOps = readFileSync("components/onboarding-operations-console.tsx", "utf8");
const offboarding = readFileSync("components/offboarding-workspace.tsx", "utf8");
const offboardingOps = readFileSync("components/offboarding-operations-console.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Onboarding starts with attention, journeys and controls before write tooling", () => {
  assert.match(recruiting, /onboarding-focus-grid/);
  assert.match(recruiting, /\/module\/workflows\?view=onboarding/);
  assert.match(recruiting, /id="onboarding-journeys"/);
  assert.match(recruiting, /id="onboarding-controls"/);
  assert.match(recruiting, /<details className="onboarding-operations-panel">/);
  assert.match(recruiting, /Authorized write tools/);
});

test("Onboarding write tools remain capability gated and relationship-scoped", () => {
  assert.match(recruiting, /if \(can\(ctx, "onboarding:write"\)\)/);
  assert.match(recruiting, /getOnboardingWorkspaceData\(ctx\)/);
  assert.match(recruiting, /getOnboardingOperationsData\(ctx\)/);
  assert.match(onboardingOps, /\/api\/onboarding\/operations/);
  assert.match(onboardingOps, /current access scope/i);
});

test("Offboarding prioritizes blockers, register and closure gate before operations", () => {
  assert.match(offboarding, /className="offboarding-focus-grid"/);
  assert.match(offboarding, /\/module\/workflows\?view=offboarding/);
  assert.match(offboarding, /id="offboarding-register"/);
  assert.match(offboarding, /id="offboarding-closure"/);
  assert.match(offboarding, /<details className="offboarding-operations-panel">/);
  assert.match(offboarding, /Final settlement/);
});

test("Offboarding write, recruiting and payroll authorities remain separated", () => {
  assert.match(offboarding, /canWrite=can\(ctx,"offboarding:write"\)/);
  assert.match(offboarding, /canRecruitingWrite=can\(ctx,"recruiting:write"\)/);
  assert.match(offboarding, /canPrepareSettlement=can\(ctx,"payroll:prepare"\)/);
  assert.match(offboarding, /canApproveSettlement=can\(ctx,"payroll:approve"\)/);
  assert.match(offboarding, /canSettleSettlement=can\(ctx,"payroll:pay"\)/);
  assert.match(offboardingOps, /\/api\/offboarding\/processes/);
});

test("lifecycle cockpits follow responsive Warm Enterprise styling", () => {
  for (const selector of [".onboarding-operations-panel", ".offboarding-operations-panel", ".offboarding-focus-grid", ".offboarding-focus-card"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:620px\)/);
});


test("Recruiting and onboarding previews use static labels instead of fake disabled actions", () => {
  assert.doesNotMatch(recruiting, /<button[^>]*disabled/);
  assert.match(recruiting, /preview-static-label/);
  assert.match(recruiting, /pipeline-count-label/);
  assert.match(recruiting, /Static preview/);
  assert.match(recruiting, /Statik önizleme/);
});
