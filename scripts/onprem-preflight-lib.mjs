import fs from "node:fs";
import path from "node:path";

export const REQUIRED_SECRET_MINIMUMS = Object.freeze({
  POSTGRES_PASSWORD: 24,
  OBJECT_STORAGE_SECRET_KEY: 24,
  HRBP_SESSION_SECRET: 48,
  HRBP_ENGAGEMENT_RESPONSE_SECRET: 48,
  HRBP_DOCUMENT_SCAN_TOKEN: 24,
  HRBP_MAINTENANCE_TOKEN: 24,
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
  "HRBP_OIDC_ISSUER",
  "HRBP_OIDC_CLIENT_ID",
  "HRBP_OIDC_CLIENT_SECRET",
  "HRBP_OIDC_REDIRECT_URI",
  "HRBP_AUTH_TENANT_ID",
  "HRBP_BOOTSTRAP_ADMIN_EMAIL"
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
  if (!validUrl(env.HRBP_OIDC_ISSUER, { httpsOnly: true })) errors.push("HRBP_OIDC_ISSUER must be a valid HTTPS URL.");
  if (!validUrl(env.HRBP_OIDC_REDIRECT_URI, { httpsOnly: true })) errors.push("HRBP_OIDC_REDIRECT_URI must be a valid HTTPS URL.");

  if (validUrl(env.APP_URL, { httpsOnly: true }) && validUrl(env.HRBP_OIDC_REDIRECT_URI, { httpsOnly: true })) {
    const app = new URL(env.APP_URL);
    const redirect = new URL(env.HRBP_OIDC_REDIRECT_URI);
    if (app.origin !== redirect.origin || redirect.pathname !== "/api/auth/callback" || redirect.search || redirect.hash) {
      errors.push("HRBP_OIDC_REDIRECT_URI must use APP_URL origin and the exact /api/auth/callback path.");
    }
  }

  if ((env.HRBP_LOCAL_AUTH_ENABLED ?? "false").toLowerCase() !== "false") {
    warnings.push("Local authentication is enabled; production on-prem deployments should normally use enterprise OIDC only.");
  }

  if (!/^[A-Za-z0-9._-]{1,64}$/.test(env.POSTGRES_USER ?? "")) errors.push("POSTGRES_USER contains unsupported characters.");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(env.POSTGRES_DB ?? "")) errors.push("POSTGRES_DB contains unsupported characters.");
  if (env.POSTGRES_PASSWORD && env.POSTGRES_PASSWORD === env.POSTGRES_USER) errors.push("POSTGRES_PASSWORD must not equal POSTGRES_USER.");

  if (!/^[A-Za-z0-9._-]{3,63}$/.test(env.OBJECT_STORAGE_BUCKET ?? "")) errors.push("OBJECT_STORAGE_BUCKET has an invalid name.");
  if ((env.OBJECT_STORAGE_ACCESS_KEY ?? "").length < 4) errors.push("OBJECT_STORAGE_ACCESS_KEY is too short.");

  const adminEmail = env.HRBP_BOOTSTRAP_ADMIN_EMAIL ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errors.push("HRBP_BOOTSTRAP_ADMIN_EMAIL must be a valid email address.");

  if ((env.HRBP_ALLOWED_EMAIL_DOMAINS ?? "").includes("*")) errors.push("HRBP_ALLOWED_EMAIL_DOMAINS must not contain wildcard domains.");

  for (const key of ["POSTGRES_IMAGE", "OBJECT_STORAGE_IMAGE", "OBJECT_STORAGE_TOOL_IMAGE"]) {
    if (env[key] && !imagePinned(env[key])) errors.push(`${key} must use an explicit tag or digest and must not use a mutable channel.`);
  }

  const bind = env.HRBP_HTTP_BIND ?? "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(bind)) {
    warnings.push("HRBP_HTTP_BIND exposes the app beyond loopback; terminate TLS and restrict network access before production use.");
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
