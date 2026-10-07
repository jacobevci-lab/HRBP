import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const envFile = process.env.HRBP_ENV_FILE || ".env.onprem";
const composeFile = process.env.HRBP_COMPOSE_FILE || "docker-compose.onprem.yml";
const errors = [];
const warnings = [];

function error(message) { errors.push(message); }
function warning(message) { warnings.push(message); }

function parseEnv(raw) {
  const result = new Map();
  for (const original of raw.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const index = normalized.indexOf("=");
    if (index < 1) continue;
    const key = normalized.slice(0, index).trim();
    let value = normalized.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.set(key, value);
  }
  return result;
}

function value(env, key) {
  return env.get(key) ?? "";
}

function requireSecret(env, key, minLength) {
  const secret = value(env, key);
  if (!secret) return error(`${key} is required.`);
  if (/CHANGE_ME|YOUR-|example\.internal/i.test(secret)) return error(`${key} still contains a placeholder value.`);
  if (secret.length < minLength) return error(`${key} must contain at least ${minLength} characters.`);
  if (/\s/.test(secret)) return error(`${key} must not contain whitespace.`);
}

let raw;
try {
  raw = await readFile(envFile, "utf8");
} catch {
  console.error(`On-prem preflight failed: environment file not found: ${envFile}`);
  process.exit(1);
}
const env = parseEnv(raw);

const appUrlRaw = value(env, "APP_URL");
try {
  const appUrl = new URL(appUrlRaw);
  if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password || appUrl.search || appUrl.hash) {
    error("APP_URL must be a clean HTTPS origin.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname)) error("APP_URL must not use a loopback hostname.");
} catch {
  error("APP_URL must be a valid HTTPS URL.");
}

for (const [key, length] of [
  ["POSTGRES_PASSWORD", 32],
  ["OBJECT_STORAGE_SECRET_KEY", 32],
  ["HRBP_SESSION_SECRET", 64],
  ["HRBP_ENGAGEMENT_RESPONSE_SECRET", 64],
  ["HRBP_DOCUMENT_SCAN_TOKEN", 32],
  ["HRBP_MAINTENANCE_TOKEN", 32]
]) requireSecret(env, key, length);

const secrets = [
  "POSTGRES_PASSWORD", "OBJECT_STORAGE_SECRET_KEY", "HRBP_SESSION_SECRET",
  "HRBP_ENGAGEMENT_RESPONSE_SECRET", "HRBP_DOCUMENT_SCAN_TOKEN", "HRBP_MAINTENANCE_TOKEN"
].map((key) => [key, value(env, key)]).filter(([, secret]) => secret);
for (let i = 0; i < secrets.length; i += 1) {
  for (let j = i + 1; j < secrets.length; j += 1) {
    if (secrets[i][1] === secrets[j][1]) error(`${secrets[i][0]} and ${secrets[j][0]} must not reuse the same secret.`);
  }
}

if (value(env, "HRBP_LOCAL_AUTH_ENABLED").toLowerCase() === "true") {
  warning("Local authentication is enabled. Enterprise production deployments should prefer OIDC unless local break-glass access is explicitly approved.");
} else {
  for (const key of [
    "HRBP_OIDC_ISSUER", "HRBP_OIDC_CLIENT_ID", "HRBP_OIDC_CLIENT_SECRET",
    "HRBP_OIDC_REDIRECT_URI", "HRBP_AUTH_TENANT_ID", "HRBP_BOOTSTRAP_ADMIN_EMAIL",
    "HRBP_ALLOWED_EMAIL_DOMAINS"
  ]) {
    const configured = value(env, key);
    if (!configured || /CHANGE_ME|YOUR-|example\.internal/i.test(configured)) error(`${key} must be configured when local authentication is disabled.`);
  }
  try {
    const issuer = new URL(value(env, "HRBP_OIDC_ISSUER"));
    if (issuer.protocol !== "https:") error("HRBP_OIDC_ISSUER must use HTTPS.");
  } catch { error("HRBP_OIDC_ISSUER must be a valid HTTPS URL."); }
  try {
    const redirect = new URL(value(env, "HRBP_OIDC_REDIRECT_URI"));
    const app = new URL(appUrlRaw);
    if (redirect.protocol !== "https:" || redirect.origin !== app.origin || redirect.pathname !== "/api/auth/callback") {
      error("HRBP_OIDC_REDIRECT_URI must use APP_URL origin and /api/auth/callback.");
    }
  } catch { error("HRBP_OIDC_REDIRECT_URI must be a valid callback URL."); }
}

const tenant = value(env, "HRBP_AUTH_TENANT_ID");
if (!tenant || !/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(tenant) || tenant === "customer-production") {
  error("HRBP_AUTH_TENANT_ID must be a customer-specific stable tenant identifier.");
}

const adminEmail = value(env, "HRBP_BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
const allowedDomains = value(env, "HRBP_ALLOWED_EMAIL_DOMAINS").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
if (adminEmail && allowedDomains.length && !allowedDomains.some((domain) => adminEmail.endsWith(`@${domain}`))) {
  error("HRBP_BOOTSTRAP_ADMIN_EMAIL must belong to HRBP_ALLOWED_EMAIL_DOMAINS.");
}

const interval = Number(value(env, "HRBP_MAINTENANCE_INTERVAL_SECONDS") || "900");
if (!Number.isInteger(interval) || interval < 300 || interval > 86400) {
  error("HRBP_MAINTENANCE_INTERVAL_SECONDS must be an integer between 300 and 86400.");
}

const bind = value(env, "HRBP_HTTP_BIND") || "127.0.0.1";
if (!["127.0.0.1", "::1"].includes(bind)) {
  warning("HRBP_HTTP_BIND is not loopback. Confirm host firewall and reverse-proxy controls before production exposure.");
}

for (const key of ["POSTGRES_IMAGE", "OBJECT_STORAGE_IMAGE", "OBJECT_STORAGE_TOOL_IMAGE"]) {
  const image = value(env, key);
  if (!image) continue;
  if (/:latest(?:@|$)/.test(image) || !image.includes(":")) error(`${key} must use an explicit immutable release tag/digest, never latest.`);
}

if (value(env, "OBJECT_STORAGE_ENDPOINT") && !/^https:\/\//i.test(value(env, "OBJECT_STORAGE_ENDPOINT"))) {
  warning("External OBJECT_STORAGE_ENDPOINT is not HTTPS. This is acceptable only for the bundled private Compose service.");
}

if (process.env.HRBP_PREFLIGHT_SKIP_DOCKER === "true") {
  warning("Docker Compose validation was explicitly skipped; this mode is for isolated unit tests only.");
} else {
  const compose = spawnSync("docker", ["compose", "--env-file", envFile, "-f", composeFile, "config", "--quiet"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024
  });
  if (compose.error?.code === "ENOENT") {
    error("Docker with the Compose plugin is required.");
  } else if (compose.status !== 0) {
    error("docker compose configuration validation failed.");
  }
}

const report = {
  ok: errors.length === 0,
  checkedAt: new Date().toISOString(),
  environmentFile: envFile,
  composeFile,
  errors,
  warnings
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
