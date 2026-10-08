import fs from "node:fs";
import path from "node:path";

export const REQUIRED_SECRET_MINIMUMS = Object.freeze({
  POSTGRES_PASSWORD: 24,
  OBJECT_STORAGE_SECRET_KEY: 24,
  HRBP_SESSION_SECRET: 48,
  HRBP_ENGAGEMENT_RESPONSE_SECRET: 48,
  HRBP_DOCUMENT_SCAN_TOKEN: 24,
  HRBP_MAINTENANCE_TOKEN: 24,
  HRBP_METRICS_TOKEN: 24,
  HRBP_OIDC_CLIENT_SECRET: 16
});

export const REQUIRED_KEYS = Object.freeze([
  "APP_URL",
  "POSTGRES_USER",
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_BUCKET",
  "HRBP_SESSION_SECRET",
  "HRBP_ENGAGEMENT_RESPONSE_SECRET",
  "HRBP_DOCUMENT_SCAN_TOKEN",
  "HRBP_MAINTENANCE_TOKEN",
  "HRBP_METRICS_TOKEN",
  "HRBP_OIDC_ISSUER",
  "HRBP_OIDC_CLIENT_ID",
  "HRBP_OIDC_CLIENT_SECRET",
  "HRBP_OIDC_SCOPES",
  "HRBP_OIDC_REDIRECT_URI",
  "HRBP_AUTH_TENANT_ID",
  "HRBP_BOOTSTRAP_ADMIN_EMAIL",
  "HRBP_ALLOWED_EMAIL_DOMAINS",
  "HRBP_LOCAL_AUTH_ENABLED"
]);

function parseLine(line, index) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) throw new Error(`Invalid env syntax on line ${index + 1}; expected KEY=value.`);
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

export function parseEnvText(text) {
  const env = {};
  for (const [index, line] of text.replaceAll("\r\n", "\n").split("\n").entries()) {
    const pair = parseLine(line, index);
    if (!pair) continue;
    const [key, value] = pair;
    if (Object.prototype.hasOwnProperty.call(env, key)) throw new Error(`Duplicate environment key: ${key}`);
    env[key] = value;
  }
  return env;
}

function validUrl(value, { httpsOnly = false } = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (httpsOnly && url.protocol !== "https:") return false;
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isPlaceholder(value) {
  return !value || /CHANGE_ME|YOUR-DIRECTORY|example\.internal|hrbp\.example\.internal/i.test(value);
}

function imagePinned(value) {
  if (!value) return false;
  if (/:(?:latest|edge|main|master)$/i.test(value)) return false;
  return /@sha256:[a-f0-9]{64}$/i.test(value) || /:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function validateOnpremEnv(env) {
  const errors = [];
  const warnings = [];
  for (const key of REQUIRED_KEYS) {
    if (!(key in env) || isPlaceholder(env[key])) errors.push(`${key} is missing or still contains an example placeholder.`);
  }

  for (const [key, minimum] of Object.entries(REQUIRED_SECRET_MINIMUMS)) {
    const value = env[key] ?? "";
    if (value.length < minimum) errors.push(`${key} must be at least ${minimum} characters.`);
    if (/\s/.test(value)) errors.push(`${key} must not contain whitespace.`);
  }

  const secretValues = Object.entries(REQUIRED_SECRET_MINIMUMS)
    .map(([key]) => [key, env[key]])
    .filter(([, value]) => typeof value === "string" && value);
  for (let i = 0; i < secretValues.length; i += 1) {
    for (let j = i + 1; j < secretValues.length; j += 1) {
      if (secretValues[i][1] === secretValues[j][1]) {
        errors.push(`${secretValues[i][0]} and ${secretValues[j][0]} must use different secrets.`);
      }
    }
  }

  if (!validUrl(env.APP_URL, { httpsOnly: true })) errors.push("APP_URL must be a valid HTTPS URL.");
  else {
    const app = new URL(env.APP_URL);
    if ((app.pathname && app.pathname !== "/") || app.search) errors.push("APP_URL must be an HTTPS origin without a path or query string.");
  }
  if (!validUrl(env.HRBP_OIDC_ISSUER, { httpsOnly: true })) errors.push("HRBP_OIDC_ISSUER must be a valid HTTPS URL.");
  if (!validUrl(env.HRBP_OIDC_REDIRECT_URI, { httpsOnly: true })) errors.push("HRBP_OIDC_REDIRECT_URI must be a valid HTTPS URL.");

  if (validUrl(env.APP_URL, { httpsOnly: true }) && validUrl(env.HRBP_OIDC_REDIRECT_URI, { httpsOnly: true })) {
    const app = new URL(env.APP_URL);
    const redirect = new URL(env.HRBP_OIDC_REDIRECT_URI);
    if (app.origin !== redirect.origin || redirect.pathname !== "/api/auth/callback" || redirect.search || redirect.hash) {
      errors.push("HRBP_OIDC_REDIRECT_URI must use APP_URL origin and the exact /api/auth/callback path.");
    }
  }

  const localAuth = (env.HRBP_LOCAL_AUTH_ENABLED ?? "").toLowerCase();
  if (!["true", "false"].includes(localAuth)) errors.push("HRBP_LOCAL_AUTH_ENABLED must be explicitly true or false.");
  else if (localAuth === "true") {
    warnings.push("Local authentication is enabled; production on-prem deployments should normally use enterprise OIDC only.");
  }

  const scimEnabledRaw = (env.HRBP_SCIM_ENABLED ?? "false").toLowerCase();
  if (!["true", "false"].includes(scimEnabledRaw)) {
    errors.push("HRBP_SCIM_ENABLED must be explicitly true or false.");
  }
  const scimEnabled = scimEnabledRaw === "true";
  const scimAdoptionRaw = (env.HRBP_SCIM_ALLOW_UNMANAGED_ADOPTION ?? "false").toLowerCase();
  if (!["true", "false"].includes(scimAdoptionRaw)) {
    errors.push("HRBP_SCIM_ALLOW_UNMANAGED_ADOPTION must be explicitly true or false.");
  }
  if (scimEnabled) {
    const scimToken = env.HRBP_SCIM_TOKEN ?? "";
    if (!scimToken || isPlaceholder(scimToken)) errors.push("HRBP_SCIM_TOKEN is required when HRBP_SCIM_ENABLED=true.");
    if (scimToken.length < 32) errors.push("HRBP_SCIM_TOKEN must be at least 32 characters.");
    if (/\s/.test(scimToken)) errors.push("HRBP_SCIM_TOKEN must not contain whitespace.");
    if (secretValues.some(([, value]) => value === scimToken) || (env.HRBP_SMTP_PASSWORD && env.HRBP_SMTP_PASSWORD === scimToken)) {
      errors.push("HRBP_SCIM_TOKEN must not reuse another application secret.");
    }
    if (scimAdoptionRaw === "true") {
      warnings.push("SCIM unmanaged-account adoption is enabled; review existing EMPLOYEE identities before provisioning.");
    }
  }

  const scopes = new Set((env.HRBP_OIDC_SCOPES ?? "").split(/\s+/).filter(Boolean));
  for (const scope of ["openid", "profile", "email"]) {
    if (!scopes.has(scope)) errors.push(`HRBP_OIDC_SCOPES must include ${scope}.`);
  }

  if (!/^[A-Za-z0-9._-]{1,64}$/.test(env.POSTGRES_USER ?? "")) errors.push("POSTGRES_USER contains unsupported characters.");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(env.POSTGRES_DB ?? "")) errors.push("POSTGRES_DB contains unsupported characters.");
  if (env.POSTGRES_PASSWORD && env.POSTGRES_PASSWORD === env.POSTGRES_USER) errors.push("POSTGRES_PASSWORD must not equal POSTGRES_USER.");

  if (!/^[A-Za-z0-9._-]{3,63}$/.test(env.OBJECT_STORAGE_BUCKET ?? "")) errors.push("OBJECT_STORAGE_BUCKET has an invalid name.");
  if ((env.OBJECT_STORAGE_ACCESS_KEY ?? "").length < 4) errors.push("OBJECT_STORAGE_ACCESS_KEY is too short.");

  const adminEmail = env.HRBP_BOOTSTRAP_ADMIN_EMAIL ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errors.push("HRBP_BOOTSTRAP_ADMIN_EMAIL must be a valid email address.");

  if ((env.HRBP_ALLOWED_EMAIL_DOMAINS ?? "").includes("*")) errors.push("HRBP_ALLOWED_EMAIL_DOMAINS must not contain wildcard domains.");

  for (const key of ["POSTGRES_IMAGE", "OBJECT_STORAGE_IMAGE", "OBJECT_STORAGE_TOOL_IMAGE", "DOCUMENT_SCANNER_IMAGE"]) {
    if (env[key] && !imagePinned(env[key])) errors.push(`${key} must use an explicit tag or digest and must not use a mutable channel.`);
  }

  const bind = env.HRBP_HTTP_BIND ?? "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(bind)) {
    warnings.push("HRBP_HTTP_BIND exposes the app beyond loopback; terminate TLS and restrict network access before production use.");
  }

  const smtpEnabledRaw = (env.HRBP_SMTP_ENABLED ?? "false").toLowerCase();
  if (!["true", "false"].includes(smtpEnabledRaw)) {
    errors.push("HRBP_SMTP_ENABLED must be explicitly true or false.");
  }
  const smtpEnabled = smtpEnabledRaw === "true";
  const emailEvents = (env.HRBP_NOTIFICATION_EMAIL_EVENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (emailEvents.some((value) => !/^[A-Z][A-Z0-9_]{2,127}$/.test(value))) {
    errors.push("HRBP_NOTIFICATION_EMAIL_EVENTS contains an invalid event name.");
  }
  if (new Set(emailEvents).size !== emailEvents.length) {
    errors.push("HRBP_NOTIFICATION_EMAIL_EVENTS must not contain duplicate events.");
  }
  if (emailEvents.length > 200) {
    errors.push("HRBP_NOTIFICATION_EMAIL_EVENTS must contain at most 200 events.");
  }

  const allowRestrictedRaw = (env.HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED ?? "false").toLowerCase();
  if (!["true", "false"].includes(allowRestrictedRaw)) {
    errors.push("HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED must be explicitly true or false.");
  }

  const emailBatch = env.HRBP_NOTIFICATION_EMAIL_BATCH_SIZE ?? "10";
  if (!/^[0-9]+$/.test(emailBatch) || Number(emailBatch) < 1 || Number(emailBatch) > 50) {
    errors.push("HRBP_NOTIFICATION_EMAIL_BATCH_SIZE must be between 1 and 50.");
  }

  if (smtpEnabled) {
    for (const key of ["HRBP_SMTP_HOST", "HRBP_SMTP_USERNAME", "HRBP_SMTP_PASSWORD", "HRBP_SMTP_FROM"]) {
      if (!env[key] || isPlaceholder(env[key])) errors.push(`${key} is required when HRBP_SMTP_ENABLED=true.`);
    }
    if (!emailEvents.length) errors.push("HRBP_NOTIFICATION_EMAIL_EVENTS must contain at least one event when SMTP delivery is enabled.");

    const host = env.HRBP_SMTP_HOST ?? "";
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || host.includes("..") || /^[-.]|[-.]$/.test(host)) {
      errors.push("HRBP_SMTP_HOST must be a valid hostname without a URL scheme.");
    }

    const port = env.HRBP_SMTP_PORT ?? "587";
    if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      errors.push("HRBP_SMTP_PORT must be between 1 and 65535.");
    }

    const secure = (env.HRBP_SMTP_SECURE ?? "false").toLowerCase();
    if (!["true", "false"].includes(secure)) errors.push("HRBP_SMTP_SECURE must be explicitly true or false.");
    if (port === "465" && secure !== "true") errors.push("HRBP_SMTP_SECURE must be true when HRBP_SMTP_PORT=465.");
    if (port !== "465" && secure === "true") warnings.push("Implicit SMTP TLS is enabled on a non-standard port; verify the customer relay contract.");

    const smtpPassword = env.HRBP_SMTP_PASSWORD ?? "";
    if (smtpPassword.length < 16) errors.push("HRBP_SMTP_PASSWORD must be at least 16 characters.");
    if (/\s/.test(smtpPassword)) errors.push("HRBP_SMTP_PASSWORD must not contain whitespace.");
    if (smtpPassword && smtpPassword === env.HRBP_SMTP_USERNAME) errors.push("HRBP_SMTP_PASSWORD must not equal HRBP_SMTP_USERNAME.");
    if (smtpPassword && secretValues.some(([, value]) => value === smtpPassword)) {
      errors.push("HRBP_SMTP_PASSWORD must not reuse another application secret.");
    }

    const from = env.HRBP_SMTP_FROM ?? "";
    if (/[\r\n]/.test(from) || from.length > 320 || !/[A-Za-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(from)) {
      errors.push("HRBP_SMTP_FROM must contain one valid email address and no line breaks.");
    }

    const servername = env.HRBP_SMTP_TLS_SERVERNAME ?? "";
    if (servername && (!/^[A-Za-z0-9.-]{1,253}$/.test(servername) || servername.includes(".."))) {
      errors.push("HRBP_SMTP_TLS_SERVERNAME must be a valid TLS server name.");
    }

    const messageIdDomain = env.HRBP_SMTP_MESSAGE_ID_DOMAIN ?? "";
    if (messageIdDomain && (!/^[A-Za-z0-9.-]{1,253}$/.test(messageIdDomain) || messageIdDomain.includes(".."))) {
      errors.push("HRBP_SMTP_MESSAGE_ID_DOMAIN must be a valid domain.");
    }

    for (const [key, minimum, maximum] of [
      ["HRBP_SMTP_CONNECTION_TIMEOUT_MS", 3000, 20000],
      ["HRBP_SMTP_GREETING_TIMEOUT_MS", 3000, 20000],
      ["HRBP_SMTP_SOCKET_TIMEOUT_MS", 5000, 30000]
    ]) {
      const raw = env[key];
      if (raw !== undefined && (!/^[0-9]+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum)) {
        errors.push(`${key} must be between ${minimum} and ${maximum} milliseconds.`);
      }
    }
  } else if (emailEvents.length) {
    warnings.push("HRBP_NOTIFICATION_EMAIL_EVENTS is configured while HRBP_SMTP_ENABLED=false; email mirroring is disabled.");
  }

  const scanBounds = [
    ["HRBP_DOCUMENT_SCAN_POLL_SECONDS", 2, 300],
    ["HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS", 2, 20],
    ["HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS", 10, 600],
    ["HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS", 10, 3600],
    ["HRBP_DOCUMENT_SCAN_LOCK_MINUTES", 2, 120],
    ["HRBP_DOCUMENT_SCAN_REQUEST_TIMEOUT_MS", 3000, 120000],
    ["HRBP_CLAMD_TIMEOUT_MS", 3000, 120000]
  ];
  for (const [key, minimum, maximum] of scanBounds) {
    const raw = env[key];
    if (raw !== undefined && (!/^[0-9]+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum)) {
      errors.push(`${key} must be between ${minimum} and ${maximum}.`);
    }
  }

  const scanRetryBase = Number(env.HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS ?? 30);
  const scanRetryMax = Number(env.HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS ?? 600);
  if (Number.isFinite(scanRetryBase) && Number.isFinite(scanRetryMax) && scanRetryMax < scanRetryBase) {
    errors.push("HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS must be greater than or equal to HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS.");
  }

  const uploadMax = Number(env.DOCUMENT_UPLOAD_MAX_BYTES ?? 26214400);
  const scanMax = Number(env.HRBP_DOCUMENT_SCAN_MAX_BYTES ?? uploadMax);
  if (!Number.isInteger(scanMax) || scanMax < 1024 || scanMax > 100 * 1024 * 1024) {
    errors.push("HRBP_DOCUMENT_SCAN_MAX_BYTES must be between 1024 and 104857600 bytes.");
  } else if (Number.isFinite(uploadMax) && scanMax < uploadMax) {
    errors.push("HRBP_DOCUMENT_SCAN_MAX_BYTES must be greater than or equal to DOCUMENT_UPLOAD_MAX_BYTES.");
  }

  const cadence = env.HRBP_MAINTENANCE_INTERVAL_SECONDS;
  if (cadence !== undefined && (!/^[0-9]+$/.test(cadence) || Number(cadence) < 300 || Number(cadence) > 86400)) {
    errors.push("HRBP_MAINTENANCE_INTERVAL_SECONDS must be between 300 and 86400 seconds.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateSecretFileMode(filePath, platform = process.platform) {
  if (platform === "win32") return { ok: true, warning: "POSIX mode validation is unavailable on Windows." };
  const stat = fs.statSync(filePath);
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    return { ok: false, error: `${path.basename(filePath)} permissions must not grant group/other access; use chmod 600.` };
  }
  return { ok: true };
}
