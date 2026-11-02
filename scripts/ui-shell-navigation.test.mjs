import test from "node:test";
import assert from "node:assert/strict";
import { primaryShellDestinations, roleWorkspacePreferences } from "../lib/ui-shell-navigation.mjs";

test("public shell exposes only Home as a primary destination", () => {
  assert.deepEqual(primaryShellDestinations({ authenticated: false, capabilities: ["people:read", "settings:read"] }), [
    { id: "home", slug: "dashboard", label: "home" }
  ]);
});

test("authenticated primary navigation remains capability-aware", () => {
  assert.deepEqual(primaryShellDestinations({
    authenticated: true,
    role: "MANAGER",
    capabilities: ["people:read", "analytics:read"]
  }), [
    { id: "home", slug: "dashboard", label: "home" },
    { id: "work", slug: "workflows", label: "work" },
    { id: "people", slug: "manager", label: "team" },
    { id: "insights", slug: "analytics", label: "insights" }
  ]);
  const admin = primaryShellDestinations({
    authenticated: true,
    role: "TENANT_ADMIN",
    capabilities: ["people:read", "analytics:read", "settings:read"]
  });
  assert.equal(admin.at(-1)?.id, "admin");
});

test("role workspace preferences prioritize work rather than module inventory", () => {
  assert.deepEqual(roleWorkspacePreferences("EMPLOYEE"), ["workflows", "leave", "payroll", "documents", "performance", "learning"]);
  assert.deepEqual(roleWorkspacePreferences("MANAGER"), ["workflows", "people", "leave", "performance", "recruiting", "analytics"]);
  assert.deepEqual(roleWorkspacePreferences("HRBP"), ["workflows", "people", "organization", "recruiting", "talent", "workforce-planning"]);
  assert.deepEqual(roleWorkspacePreferences("HR_OPERATIONS"), ["workflows", "people", "onboarding", "offboarding", "hr-service", "documents"]);
});

test("unknown roles get a conservative generic workspace", () => {
  assert.deepEqual(roleWorkspacePreferences("NEW_ROLE"), ["workflows", "people", "documents", "policies"]);
  assert.deepEqual(roleWorkspacePreferences(null), ["workflows", "people", "documents", "policies"]);
});

test("manager primary team destination opens the dedicated Manager Hub", () => {
  const items = primaryShellDestinations({
    authenticated: true,
    role: "MANAGER",
    capabilities: ["people:read"]
  });
  assert.deepEqual(items.find((item) => item.id === "people"), { id: "people", slug: "manager", label: "team" });
});
