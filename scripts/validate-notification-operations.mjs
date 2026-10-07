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


const emailConfigPath = "lib/notification-email-config.ts";
const emailConfig = await source(emailConfigPath);
expect(emailConfigPath, emailConfig, /HRBP_SMTP_ENABLED/, "email mirroring must be explicitly feature-gated");
expect(emailConfigPath, emailConfig, /HIGHLY_RESTRICTED[\s\S]*return false/, "highly restricted events must never be mirrored to SMTP");
expect(emailConfigPath, emailConfig, /HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED/, "restricted email mirroring must require an explicit separate gate");
expect(emailConfigPath, emailConfig, /Math\.min\(50,[\s\S]*HRBP_NOTIFICATION_EMAIL_BATCH_SIZE/, "email delivery batch size must remain independently bounded");

const smtpPath = "lib/smtp-notification-provider.ts";
const smtp = await source(smtpPath);
expect(smtpPath, smtp, /from "nodemailer"/, "SMTP provider must use the pinned transport implementation");
expect(smtpPath, smtp, /requireTLS:\s*!secure/, "STARTTLS SMTP must require TLS");
expect(smtpPath, smtp, /rejectUnauthorized:\s*true/, "SMTP TLS certificate verification must remain mandatory");
expect(smtpPath, smtp, /minVersion:\s*"TLSv1\.2"/, "SMTP TLS must require TLS 1.2 or newer");
expect(smtpPath, smtp, /disableFileAccess:\s*true/, "SMTP messages must not read attachments from local files");
expect(smtpPath, smtp, /disableUrlAccess:\s*true/, "SMTP messages must not fetch remote attachment/content URLs");
expect(smtpPath, smtp, /hrbp-\$\{notification\.outboxId\}/, "SMTP messages must use a stable outbox-derived Message-ID");
expect(smtpPath, smtp, /HRBP secure notification/, "restricted SMTP messages must use a generic subject");
expect(smtpPath, smtp, /const href = restricted \? "\/" : notificationDisplayResourceHref/, "restricted SMTP messages must not expose resource-specific paths");
expect(smtpPath, smtp, /SMTP_DELIVERY_FAILED/, "SMTP provider errors must be reduced to bounded machine diagnostics");
reject(smtpPath, smtp, /rejectUnauthorized:\s*false/, "SMTP TLS verification must never be disabled");

const outboxPath = "lib/notification-outbox.ts";
const outbox = await source(outboxPath);
expect(outboxPath, outbox, /shouldMirrorNotificationToEmail/, "transactional outbox must apply centralized email routing policy");
expect(outboxPath, outbox, /EMAIL_NOTIFICATION_POLICY_BLOCKED/, "explicit EMAIL records must not bypass centralized routing/classification policy");
expect(outboxPath, outbox, /channel:\s*"EMAIL"/, "email delivery must use independent EMAIL outbox records");
expect(outboxPath, outbox, /:channel:email/, "email mirroring must have a channel-specific dedupe key");

const dispatcherPath = "lib/notification-dispatcher.ts";
const dispatcher = await source(dispatcherPath);
expect(dispatcherPath, dispatcher, /notificationEmailBatchSize/, "SMTP work must use an independent bounded batch");
expect(dispatcherPath, dispatcher, /channel:\s*"EMAIL"/, "dispatcher must select EMAIL work separately");
expect(dispatcherPath, dispatcher, /fanOutEmailRole/, "role email delivery must fan out into user-scoped outbox records");
expect(dispatcherPath, dispatcher, /sendSmtpNotification/, "dispatcher must invoke the governed SMTP provider");
expect(dispatcherPath, dispatcher, /notificationEmailPolicyAllows\(candidate\.eventType, candidate\.classification\)/, "queued EMAIL work must re-evaluate policy at delivery time");
expect(dispatcherPath, dispatcher, /NOTIFICATION_CHANNEL_UNSUPPORTED/, "unsupported channels must fail visibly instead of being ignored");

const preflightPath = "scripts/onprem-preflight-lib.mjs";
const preflight = await source(preflightPath);
expect(preflightPath, preflight, /HRBP_SMTP_ENABLED/, "on-prem preflight must understand SMTP enablement");
expect(preflightPath, preflight, /HRBP_SMTP_PASSWORD must not reuse another application secret/, "SMTP password must not reuse application secrets");
expect(preflightPath, preflight, /HRBP_NOTIFICATION_EMAIL_EVENTS must contain at least one event/, "enabled SMTP must require explicit event routing");


const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /notification-operations:validate/, "notification operations validator must be registered");
expect(packagePath, pkg, /"nodemailer":\s*"10\.0\.15"/, "SMTP transport must be pinned exactly");
expect(packagePath, pkg, /prebuild[\s\S]*notification-operations:validate/, "notification operations validation must run before production builds");

if (failures.length) {
  console.error("Notification operations validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Notification operations validation passed.");
