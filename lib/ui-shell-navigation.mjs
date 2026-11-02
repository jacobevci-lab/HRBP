const PRIMARY_CAPABILITIES = Object.freeze({
  people: "people:read",
  analytics: "analytics:read",
  settings: "settings:read"
});

const ROLE_WORKSPACE_PREFERENCES = Object.freeze({
  EMPLOYEE: ["workflows", "leave", "payroll", "documents", "performance", "learning"],
  MANAGER: ["workflows", "people", "leave", "performance", "recruiting", "analytics"],
  HRBP: ["workflows", "people", "organization", "recruiting", "talent", "workforce-planning"],
  HR_OPERATIONS: ["workflows", "people", "onboarding", "offboarding", "hr-service", "documents"],
  RECRUITER: ["workflows", "recruiting", "onboarding", "positions", "people", "documents"],
  TIME_ADMIN: ["workflows", "time-attendance", "leave", "people", "policies"],
  TALENT_ADMIN: ["workflows", "performance", "talent", "succession", "learning", "analytics"],
  COMPENSATION_ADMIN: ["workflows", "compensation", "people", "positions", "analytics"],
  PAYROLL_ADMIN: ["workflows", "payroll", "time-attendance", "leave", "people"],
  ER_INVESTIGATOR: ["workflows", "employee-relations", "people", "documents", "policies"],
  LEGAL: ["workflows", "documents", "policies", "privacy", "audit"],
  PRIVACY_OFFICER: ["workflows", "privacy", "policies", "audit", "people"],
  SECURITY_AUDITOR: ["audit", "settings"],
  TENANT_ADMIN: ["workflows", "settings", "people", "organization", "audit", "analytics"]
});

export function primaryShellDestinations({ authenticated, role, capabilities = [] }) {
  const caps = new Set(Array.isArray(capabilities) ? capabilities : []);
  const items = [{ id: "home", slug: "dashboard", label: "home" }];
  if (!authenticated) return items;
  items.push({ id: "work", slug: "workflows", label: "work" });
  if (role === "HR_OPERATIONS") items.push({ id: "operations", slug: "hr-operations", label: "operations" });
  if (caps.has(PRIMARY_CAPABILITIES.people)) {
    items.push({ id: "people", slug: role === "MANAGER" ? "manager" : role === "EMPLOYEE" ? "me" : "people", label: role === "MANAGER" ? "team" : role === "EMPLOYEE" ? "me" : "people" });
  }
  if (caps.has(PRIMARY_CAPABILITIES.analytics)) items.push({ id: "insights", slug: "analytics", label: "insights" });
  if (caps.has(PRIMARY_CAPABILITIES.settings)) items.push({ id: "admin", slug: "settings", label: "admin" });
  return items;
}

export function roleWorkspacePreferences(role) {
  const value = typeof role === "string" ? ROLE_WORKSPACE_PREFERENCES[role] : undefined;
  return value ? [...value] : ["workflows", "people", "documents", "policies"];
}
