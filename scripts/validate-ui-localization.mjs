import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
const polishIndex = layout.indexOf("./warm-enterprise-polish.css");
const unifiedIndex = layout.indexOf("./warm-enterprise-unified.css");
if (themeIndex < 0 || warmIndex < 0 || polishIndex < 0 || unifiedIndex < 0 || !(themeIndex < warmIndex && warmIndex < polishIndex && polishIndex < unifiedIndex)) {
  failures.push("app/layout.tsx: Warm Enterprise styles must load theme -> warm -> polish -> unified, in that order");
}

const domainStyles = [
  "enterprise.css", "employee360.css", "recruiting.css", "recruiting-ops.css", "work-pay.css", "growth.css",
  "employee-services.css", "governance-planning.css", "platform-admin.css", "offboarding.css", "auth.css", "lifecycle.css"
];
for (const style of domainStyles) {
  const index = layout.indexOf(`./${style}`);
  if (index < 0) failures.push(`app/layout.tsx: ${style} is not loaded`);
  else if (unifiedIndex >= 0 && index > unifiedIndex) failures.push(`app/layout.tsx: ${style} must load before the unified theme contract`);
}

const warmTheme = read("app/warm-enterprise.css");
for (const [needle, reason] of [
  ["--sidebar:#1b1e1b", "graphite sidebar token is missing"],
  ["--accent:#2f7567", "emerald accent token is missing"],
  ["--orange:#c98538", "amber accent token is missing"],
  ["html[data-theme=\"dark\"]", "dark Warm Enterprise palette is missing"]
]) requireText("app/warm-enterprise.css", warmTheme, needle, reason);

const unifiedTheme = read("app/warm-enterprise-unified.css");
for (const [needle, reason] of [
  [".decision-side,.restricted-side,.restricted-case,.ai-governance-hero", "light-only decision/restricted surfaces are not normalized"],
  [".status.scheduled,.pill.preboarding,.pill.open,.pill.approval,.pill.approved,.services-pill.in-progress", "legacy info states are not mapped to the sage neutral palette"],
  [".pipeline-board", "recruiting pipeline surface is not normalized"],
  [".score-ring:before,.control-score:before,.balance-ring:before", "chart ring inner surfaces are not theme-aware"],
  ["html[data-theme=\"dark\"] .decision-side", "dark decision surfaces are not explicitly protected"]
]) requireText("app/warm-enterprise-unified.css", unifiedTheme, needle, reason);

function walk(root, extensions, skip = new Set()) {
  const output = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) output.push(...walk(full, extensions, skip));
    else if (extensions.some((ext) => name.endsWith(ext)) && !skip.has(relative(process.cwd(), full).replaceAll("\\", "/"))) output.push(full);
  }
  return output;
}

function hexToHsl(hex) {
  const raw = hex.slice(1);
  if (raw.length !== 3 && raw.length !== 6) return null;
  const normalized = raw.length === 3 ? raw.split("").map((char) => char + char).join("") : raw;
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation, lightness };
}

// globals.css is the historical structural base. The final unified stylesheet intentionally neutralizes its legacy status colors.
// Every domain stylesheet, modern theme layer and component source must stay free of saturated blue/navy literals.
const scanFiles = [
  ...walk(join(process.cwd(), "app"), [".css", ".tsx", ".ts"], new Set(["app/globals.css"])),
  ...walk(join(process.cwd(), "components"), [".css", ".tsx", ".ts"])
];
const seenBlueFailures = new Set();
for (const fullPath of scanFiles) {
  const rel = relative(process.cwd(), fullPath).replaceAll("\\", "/");
  const content = readFileSync(fullPath, "utf8");
  for (const match of content.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g)) {
    const hsl = hexToHsl(match[0]);
    if (!hsl) continue;
    if (hsl.hue >= 190 && hsl.hue <= 235 && hsl.saturation >= 0.18) {
      const key = `${rel}:${match[0].toLowerCase()}`;
      if (!seenBlueFailures.has(key)) {
        seenBlueFailures.add(key);
        failures.push(`${rel}: saturated blue/navy literal ${match[0]} violates the Warm Enterprise graphite/emerald/amber palette`);
      }
    }
  }
}

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
  console.error("UI localization/theme validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`UI localization/theme validation passed (${new Set(navigationKeys).size} navigation keys; ${scanFiles.length} theme sources checked).`);
