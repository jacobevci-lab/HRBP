import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const routePath = "app/api/settings/notifications/operations/route.ts";
const route = await source(routePath);
expect(routePath, route, /can\(ctx,\s*"settings:read"\)/, "notification operations telemetry must require settings read authority");
expect(routePath, route, /tenantId:\s*ctx\.tenantId/, "notification operations telemetry must remain tenant scoped");
expect(routePath, route, /take:\s*limitFrom\(request\)/, "notification operations telemetry must remain bounded");
expect(routePath, route, /status:\s*\{\s*in:\s*operationalStatuses\s*\}/, "operations view must project only open delivery states");
expect(routePath, route, /lastError:\s*true/, "operations view must expose bounded dispatcher errors");
reject(routePath, route, /payload:\s*true|dedupeKey:\s*true|recipientUserId:\s*true/, "operations telemetry must not project notification payloads, dedupe keys or recipients");

const retryPath = "app/api/settings/notifications/retry/route.ts";
const retry = await source(retryPath);
expect(retryPath, retry, /settings:write/, "notification retry must require settings write authority");
expect(retryPath, retry, /mutationOriginAllowed\(request\)/, "notification retry must enforce origin checks");
expect(retryPath, retry, /requestedId/, "notification retry must support a targeted retry path");
expect(retryPath, retry, /NotificationOutboxStatus\.FAILED[\s\S]*NotificationOutboxStatus\.DEAD_LETTER/, "targeted retry must remain limited to retryable failure states");
expect(retryPath, retry, /tenantId:\s*ctx\.tenantId/, "targeted retry must remain tenant scoped");
expect(retryPath, retry, /settings\.notification-requeued/, "targeted retries must be audited");
expect(retryPath, retry, /attempts:\s*0[\s\S]*nextAttemptAt:\s*new Date\(\)/, "retry must reset governed delivery state");

const componentPath = "components/notification-operations-console.tsx";
const component = await source(componentPath);
expect(componentPath, component, /\/api\/settings\/notifications\/operations/, "operations console must consume the governed telemetry route");
expect(componentPath, component, /\/api\/settings\/notifications\/retry/, "operations console must use the governed retry route");
expect(componentPath, component, /FAILED[\s\S]*DEAD_LETTER/, "operations console must expose failure state filters");
expect(componentPath, component, /canWrite/, "retry controls must be capability-gated");
expect(componentPath, component, /payload data is never projected|payload verisi bu ekrana taşınmaz/, "operations console must disclose minimized data projection");

const settingsPath = "components/settings-live-page.tsx";
const settings = await source(settingsPath);
expect(settingsPath, settings, /NotificationOperationsConsole canWrite=\{canWrite\}/, "tenant settings must mount notification operations console with write authority state");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /notification-operations:validate/, "notification operations validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*notification-operations:validate/, "notification operations validation must run before production builds");

if (failures.length) {
  console.error("Notification operations validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Notification operations validation passed.");
