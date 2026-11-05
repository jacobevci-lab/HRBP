import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = readFileSync("lib/hr-operations-hub-data.ts", "utf8");
const workspace = readFileSync("components/hr-operations-hub.tsx", "utf8");
const page = readFileSync("app/module/hr-operations/page.tsx", "utf8");
const shellNav = readFileSync("lib/ui-shell-navigation.mjs", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("HR Operations Hub is explicitly role- and tenant-scoped", () => {
  assert.match(data, /ctx\.role !== PlatformRole\.HR_OPERATIONS/);
  assert.ok((data.match(/tenantId: ctx\.tenantId/g) ?? []).length >= 10);
  assert.doesNotMatch(data, /workspaceTenantId/);
});

test("operations attention combines lifecycle, service and data-quality signals", () => {
  for (const pattern of [
    /OnboardingStatus\.BLOCKED/,
    /OnboardingTaskStatus\.BLOCKED/,
    /SeparationStatus\.CLOSED/,
    /ExitTaskStatus\.BLOCKED/,
    /ServicePriority\.CRITICAL/,
    /slaDueAt: \{ lt: now \}/,
    /ScheduledPositionChangeStatus\.BLOCKED/,
    /positionId: null/,
    /person: \{ workEmail: null \}/
  ]) assert.match(data, pattern);
});

test("Operations Hub links attention to the existing governed workspaces", () => {
  assert.match(page, /<AppShell><HROperationsHub\/><\/AppShell>/);
  for (const href of ["/module/workflows","/module/onboarding","/module/offboarding","/module/hr-service","/module/people"]) {
    assert.ok(workspace.includes(href), href + " must remain reachable");
  }
  assert.match(workspace, /totalOperationalAttention/);
  assert.match(workspace, /Data quality/);
});

test("HR Operations quick access uses the dedicated hub", () => {
  assert.match(shellNav, /role === "HR_OPERATIONS".*slug: "hr-operations"/s);
});

test("Operations Hub uses responsive Warm Enterprise surfaces", () => {
  for (const selector of [".operations-hub", ".operations-attention-grid", ".operations-attention-card", ".operations-lane"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
});
