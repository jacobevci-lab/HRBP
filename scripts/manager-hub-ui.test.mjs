import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = readFileSync("lib/manager-hub-data.ts", "utf8");
const workspace = readFileSync("components/manager-hub.tsx", "utf8");
const page = readFileSync("app/module/manager/page.tsx", "utf8");
const shellNav = readFileSync("lib/ui-shell-navigation.mjs", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Manager Hub is relationship-scoped to the authenticated manager employment", () => {
  assert.match(data, /ctx\.role !== PlatformRole\.MANAGER \|\| !ctx\.employmentId/);
  assert.match(data, /tenantId: ctx\.tenantId/);
  assert.match(data, /managerEmploymentId: ctx\.employmentId/);
  assert.match(data, /status: \{ not: EmploymentStatus\.TERMINATED \}/);
  assert.doesNotMatch(data, /resolveEmploymentScope\([^)]*null|tenantId:\s*workspaceTenantId/);
});

test("manager attention metrics use only scoped team domain records", () => {
  for (const pattern of [
    /employmentId: \{ in: employmentIds \}/,
    /LeaveRequestStatus\.PENDING/,
    /TimeEntryStatus\.SUBMITTED/,
    /ReviewStatus\.MANAGER_REVIEW/,
    /GoalStatus\.AT_RISK/,
    /LearningAssignmentStatus\.OVERDUE/
  ]) assert.match(data, pattern);
  assert.match(data, /can\(ctx, "leave:read"\)/);
  assert.match(data, /can\(ctx, "time:read"\)/);
  assert.match(data, /can\(ctx, "performance:read"\)/);
  assert.match(data, /can\(ctx, "learning:read"\)/);
});

test("Manager Hub prioritizes work, team attention and governed deep links", () => {
  assert.match(page, /<AppShell><ManagerHub\/><\/AppShell>/);
  assert.match(workspace, /Manager Hub/);
  assert.match(workspace, /\/module\/workflows/);
  assert.match(workspace, /\/module\/workflows\?view=leave/);
  assert.match(workspace, /\/module\/workflows\?view=time-attendance/);
  assert.match(workspace, /\/module\/performance/);
  assert.match(workspace, /\/module\/recruiting/);
  assert.match(workspace, /\/module\/employee-360\?person=/);
});

test("manager primary navigation points to the dedicated hub rather than generic People", () => {
  assert.match(shellNav, /slug: role === "MANAGER" \? "manager" : "people"/);
});

test("Manager Hub follows the existing responsive Warm Enterprise surface", () => {
  for (const selector of [".manager-hub", ".manager-hub-actions", ".manager-hub-action", ".manager-hub-restricted"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:620px\)\{\.manager-hub-actions/);
});
