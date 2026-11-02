import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = readFileSync("lib/employee-home-data.ts", "utf8");
const workspace = readFileSync("components/employee-home.tsx", "utf8");
const page = readFileSync("app/module/me/page.tsx", "utf8");
const root = readFileSync("app/page.tsx", "utf8");
const roleAware = readFileSync("components/role-aware-home.tsx", "utf8");
const shellNav = readFileSync("lib/ui-shell-navigation.mjs", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

test("Employee Home is strictly self-scoped to signed employment identity", () => {
  assert.match(data, /ctx\.role !== PlatformRole\.EMPLOYEE \|\| !ctx\.employmentId/);
  assert.match(data, /id: ctx\.employmentId, tenantId: ctx\.tenantId/);
  assert.ok((data.match(/employmentId: ctx\.employmentId/g) ?? []).length >= 6);
  assert.match(data, /requestorId: ctx\.actorId/);
  assert.doesNotMatch(data, /workspaceTenantId|managerEmploymentId:/);
});

test("Employee Home surfaces self-service without reading payroll amounts directly", () => {
  for (const href of ["/module/workflows","/module/leave","/module/payroll","/module/documents","/module/performance","/module/learning","/module/hr-service","/module/policies"]) {
    assert.ok(workspace.includes(href), href + " must remain reachable");
  }
  assert.doesNotMatch(data, /payrollResult|netPay|grossPay|taxAmount/);
  assert.match(workspace, /audited payroll self-service/i);
});

test("role-aware Home dispatches employee, manager and operations personas before generic dashboard", () => {
  assert.match(root, /<AppShell><RoleAwareHome\/><\/AppShell>/);
  assert.match(roleAware, /PlatformRole\.EMPLOYEE[\s\S]*<EmployeeHome\/>/);
  assert.match(roleAware, /PlatformRole\.MANAGER[\s\S]*<ManagerHub\/>/);
  assert.match(roleAware, /PlatformRole\.HR_OPERATIONS[\s\S]*<HROperationsHub\/>/);
  assert.match(roleAware, /return <Dashboard\/>/);
});

test("employee quick access points to My Profile rather than the generic directory", () => {
  assert.match(shellNav, /role === "EMPLOYEE" \? "me" : "people"/);
  assert.match(page, /<AppShell><EmployeeHome\/><\/AppShell>/);
});

test("Employee Home uses responsive Warm Enterprise surfaces", () => {
  for (const selector of [".employee-home", ".employee-home-hero", ".employee-home-grid", ".employee-home-action"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
});
