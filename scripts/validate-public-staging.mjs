import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(path, "utf8");
}

const checks = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) checks.push(`${path}: ${message}`);
}
function reject(path, text, pattern, message) {
  if (pattern.test(text)) checks.push(`${path}: ${message}`);
}

const shellPath = "components/app-shell.tsx";
const shell = await source(shellPath);
expect(shellPath, shell, /if\s*\(!authenticated\)\s*return\s+true;/, "public staging must keep the complete module navigation discoverable after session resolution");
expect(shellPath, shell, /if\s*\(loading\)\s*return\s+!item\.requiredCapability\s*&&\s*!item\.requiresAuthentication;/, "navigation must avoid privileged-item flash while session state is loading");

const publicLandingPath = "components/public-module-landing.tsx";
const publicLanding = await source(publicLandingPath);
expect(publicLandingPath, publicLanding, /Live tenant data and mutations are disabled/, "public module surfaces must explicitly identify the no-live-data boundary");
expect(publicLandingPath, publicLanding, /PublicSettingsPreview/, "settings must have a dedicated non-interactive public preview");
reject(publicLandingPath, publicLanding, /PlatformAdminWorkspace/, "public settings must not mount authenticated administration controls");

const dynamicModulePath = "app/module/[slug]/page.tsx";
const dynamicModule = await source(dynamicModulePath);
expect(dynamicModulePath, dynamicModule, /if\s*\(!ctx\)\s*return\s*<AppShell><PublicModuleLanding\s+slug=\{slug\}\/><\/AppShell>;/, "unauthenticated generic module routes must short-circuit to PublicModuleLanding before live workspaces");

const searchPath = "app/api/search/route.ts";
const search = await source(searchPath);
expect(searchPath, search, /if\s*\(!ctx\)\s*return\s+true;/, "public search must expose the same module catalog as public navigation");
expect(searchPath, search, /if\s*\(!ctx\)\s*return\s+Response\.json\(\{\s*data:\s*moduleResults\s*\}/, "public search must return before any database-backed people or position lookup");

const dedicatedCoreRoutes = ["people", "organization", "positions", "employee-360"];
for (const slug of dedicatedCoreRoutes) {
  const path = `app/module/${slug}/page.tsx`;
  const text = await source(path);
  expect(path, text, /PublicCoreLanding/, "dedicated core route must expose the synthetic staging landing");
  expect(path, text, /if\s*\(!ctx\)\s*return/, "dedicated core route must stop before the live data path when unauthenticated");
}

const sharedPublicPages = [
  ["components/growth-module-page.tsx", /GrowthWorkspace/],
  ["components/work-pay-module-page.tsx", /WorkPayWorkspace/],
  ["components/governance-planning-module-page.tsx", /GovernancePlanningWorkspace/]
];
for (const [path, workspacePattern] of sharedPublicPages) {
  const text = await source(path);
  expect(path, text, /if\s*\(!ctx\)/, "shared module page must have an explicit unauthenticated staging branch");
  expect(path, text, workspacePattern, "shared module page must render its synthetic workspace in staging");
}

if (checks.length) {
  console.error("Public staging contract validation failed:\n");
  for (const check of checks) console.error(`- ${check}`);
  process.exit(1);
}

console.log("Validated public staging contract: navigation, search, module routing and admin isolation are consistent.");
