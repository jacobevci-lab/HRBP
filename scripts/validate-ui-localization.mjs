import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const failures = [];
const requireText = (path, content, needle, reason) => {
  if (!content.includes(needle)) failures.push(`${path}: ${reason}`);
};

const navigation = read("lib/navigation.ts");
const i18n = read("lib/i18n.ts");
const navigationKeys = [...navigation.matchAll(/labelKey:\s*"([^"]+)"/g)].map((match) => match[1]);
for (const key of new Set(navigationKeys)) {
  const occurrences = i18n.split(`"${key}"`).length - 1;
  if (occurrences < 2) failures.push(`lib/i18n.ts: navigation key ${key} must exist in both EN and TR dictionaries`);
}

const layout = read("app/layout.tsx");
requireText("app/layout.tsx", layout, "hrbp-locale", "locale bootstrap must remain enabled");
const themeIndex = layout.indexOf("./theme.css");
const warmIndex = layout.indexOf("./warm-enterprise.css");
if (themeIndex < 0 || warmIndex < 0 || warmIndex < themeIndex) {
  failures.push("app/layout.tsx: warm-enterprise.css must be loaded after theme.css");
}

const warmTheme = read("app/warm-enterprise.css");
for (const [needle, reason] of [
  ["--sidebar:#1b1e1b", "graphite sidebar token is missing"],
  ["--accent:#2f7567", "emerald accent token is missing"],
  ["--orange:#c98538", "amber accent token is missing"],
  ["html[data-theme=\"dark\"]", "dark Warm Enterprise palette is missing"]
]) requireText("app/warm-enterprise.css", warmTheme, needle, reason);

const localeAwareFiles = new Map([
  ["components/app-shell.tsx", ["LocaleProvider", "LocaleToggle"]],
  ["components/dashboard.tsx", ["getServerLocale"]],
  ["components/module-landing.tsx", ["getServerLocale", "ProtectedFallback"]],
  ["components/core-hr-workspace.tsx", ["useLocale"]],
  ["components/work-pay-workspace.tsx", ["getServerLocale"]],
  ["components/growth-workspace.tsx", ["getServerLocale"]],
  ["components/employee-services-workspace.tsx", ["getServerLocale"]],
  ["components/governance-planning-workspace.tsx", ["getServerLocale"]],
  ["components/platform-admin-workspace.tsx", ["getServerLocale"]],
  ["components/offboarding-workspace.tsx", ["getServerLocale"]],
  ["app/auth/sign-in/page.tsx", ["getServerLocale"]],
  ["components/session-indicator.tsx", ["useLocale"]],
  ["components/topbar-account.tsx", ["useLocale"]]
]);

for (const [path, markers] of localeAwareFiles) {
  const content = read(path);
  for (const marker of markers) requireText(path, content, marker, `missing locale marker ${marker}`);
}

if (failures.length) {
  console.error("UI localization validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`UI localization validation passed (${new Set(navigationKeys).size} navigation keys checked).`);
