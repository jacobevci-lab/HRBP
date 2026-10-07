import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvText, validateOnpremEnv } from "./onprem-preflight-lib.mjs";

const base = {
  APP_URL: "https://hrbp.acme.internal",
  POSTGRES_USER: "hrbp",
  POSTGRES_DB: "hrbp",
  POSTGRES_PASSWORD: "db-password-abcdefghijklmnopqrstuvwxyz",
  OBJECT_STORAGE_ACCESS_KEY: "hrbp-app",
  OBJECT_STORAGE_SECRET_KEY: "object-secret-abcdefghijklmnopqrstuvwxyz",
  OBJECT_STORAGE_BUCKET: "hrbp-private",
  HRBP_SESSION_SECRET: "session-secret-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ-123456",
  HRBP_ENGAGEMENT_RESPONSE_SECRET: "engagement-secret-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  HRBP_DOCUMENT_SCAN_TOKEN: "document-token-abcdefghijklmnopqrstuvwxyz",
  HRBP_MAINTENANCE_TOKEN: "maintenance-token-abcdefghijklmnopqrstuvwxyz",
  HRBP_OIDC_ISSUER: "https://login.example.com/tenant/v2.0",
  HRBP_OIDC_CLIENT_ID: "client-id-123",
  HRBP_OIDC_CLIENT_SECRET: "oidc-secret-abcdefghijklmnop",
  HRBP_OIDC_SCOPES: "openid profile email",
  HRBP_OIDC_REDIRECT_URI: "https://hrbp.acme.internal/api/auth/callback",
  HRBP_AUTH_TENANT_ID: "acme-prod",
  HRBP_BOOTSTRAP_ADMIN_EMAIL: "admin@acme.internal",
  HRBP_ALLOWED_EMAIL_DOMAINS: "acme.internal",
  HRBP_LOCAL_AUTH_ENABLED: "false",
  HRBP_HTTP_BIND: "127.0.0.1",
  HRBP_MAINTENANCE_INTERVAL_SECONDS: "900",
  POSTGRES_IMAGE: "postgres:17-alpine",
  OBJECT_STORAGE_IMAGE: "chrislusf/seaweedfs:4.48",
  OBJECT_STORAGE_TOOL_IMAGE: "rclone/rclone:1.75.1"
};

test("parses comments, quoted values and rejects duplicate keys", () => {
  assert.deepEqual(parseEnvText("# comment\nA=one\nB=\"two\"\n"), { A: "one", B: "two" });
  assert.throws(() => parseEnvText("A=one\nA=two\n"), /Duplicate/);
  assert.throws(() => parseEnvText("bad line\n"), /Invalid env syntax/);
});

test("accepts a production-shaped on-prem environment", () => {
  const result = validateOnpremEnv({ ...base });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.errors, []);
});

test("rejects placeholders, weak/reused secrets and invalid redirect", () => {
  const env = {
    ...base,
    POSTGRES_PASSWORD: "CHANGE_ME",
    HRBP_SESSION_SECRET: base.HRBP_MAINTENANCE_TOKEN,
    HRBP_OIDC_REDIRECT_URI: "https://other.internal/callback"
  };
  const result = validateOnpremEnv(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes("POSTGRES_PASSWORD")));
  assert.ok(result.errors.some((entry) => entry.includes("different secrets")));
  assert.ok(result.errors.some((entry) => entry.includes("exact /api/auth/callback")));
});

test("rejects mutable images, wildcard domains and unsafe maintenance cadence", () => {
  const result = validateOnpremEnv({
    ...base,
    POSTGRES_IMAGE: "postgres:latest",
    HRBP_ALLOWED_EMAIL_DOMAINS: "*",
    HRBP_MAINTENANCE_INTERVAL_SECONDS: "60"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes("POSTGRES_IMAGE")));
  assert.ok(result.errors.some((entry) => entry.includes("wildcard")));
  assert.ok(result.errors.some((entry) => entry.includes("300 and 86400")));
});

test("warns when local auth or non-loopback app exposure is enabled", () => {
  const result = validateOnpremEnv({
    ...base,
    HRBP_LOCAL_AUTH_ENABLED: "true",
    HRBP_HTTP_BIND: "0.0.0.0"
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
});

test("rejects incomplete OIDC scopes and non-origin APP_URL", () => {
  const result = validateOnpremEnv({
    ...base,
    APP_URL: "https://hrbp.acme.internal/subpath",
    HRBP_OIDC_SCOPES: "openid profile"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes("without a path")));
  assert.ok(result.errors.some((entry) => entry.includes("include email")));
});

test("validation diagnostics never echo secret values", () => {
  const secret = "super-secret-material-that-must-not-leak-123456789";
  const result = validateOnpremEnv({
    ...base,
    POSTGRES_PASSWORD: secret,
    HRBP_MAINTENANCE_TOKEN: secret
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes("different secrets")));
  assert.ok(!JSON.stringify(result).includes(secret));
});


test("accepts bounded TLS SMTP delivery configuration", () => {
  const result = validateOnpremEnv({
    ...base,
    HRBP_SMTP_ENABLED: "true",
    HRBP_NOTIFICATION_EMAIL_EVENTS: "LOCAL_AUTH_ACCOUNT_LOCKED,HR_SERVICE_ESCALATED",
    HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED: "false",
    HRBP_NOTIFICATION_EMAIL_BATCH_SIZE: "10",
    HRBP_SMTP_HOST: "smtp.acme.internal",
    HRBP_SMTP_PORT: "587",
    HRBP_SMTP_SECURE: "false",
    HRBP_SMTP_USERNAME: "hrbp-smtp",
    HRBP_SMTP_PASSWORD: "smtp-password-abcdefghijklmnop",
    HRBP_SMTP_FROM: "HRBP <hrbp@acme.internal>",
    HRBP_SMTP_TLS_SERVERNAME: "smtp.acme.internal",
    HRBP_SMTP_MESSAGE_ID_DOMAIN: "acme.internal",
    HRBP_SMTP_CONNECTION_TIMEOUT_MS: "8000",
    HRBP_SMTP_GREETING_TIMEOUT_MS: "8000",
    HRBP_SMTP_SOCKET_TIMEOUT_MS: "15000"
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects unsafe or incomplete SMTP configuration", () => {
  const result = validateOnpremEnv({
    ...base,
    HRBP_SMTP_ENABLED: "true",
    HRBP_NOTIFICATION_EMAIL_EVENTS: "bad-event,LOCAL_AUTH_ACCOUNT_LOCKED,LOCAL_AUTH_ACCOUNT_LOCKED",
    HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED: "maybe",
    HRBP_NOTIFICATION_EMAIL_BATCH_SIZE: "500",
    HRBP_SMTP_HOST: "https://smtp.acme.internal",
    HRBP_SMTP_PORT: "70000",
    HRBP_SMTP_SECURE: "maybe",
    HRBP_SMTP_USERNAME: "smtp-user",
    HRBP_SMTP_PASSWORD: base.HRBP_MAINTENANCE_TOKEN,
    HRBP_SMTP_FROM: "bad\nfrom@example.com",
    HRBP_SMTP_TLS_SERVERNAME: "bad..name"
  });
  assert.equal(result.ok, false);
  for (const fragment of [
    "invalid event name",
    "duplicate events",
    "ALLOW_RESTRICTED",
    "EMAIL_BATCH_SIZE",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "must not reuse",
    "SMTP_FROM",
    "TLS_SERVERNAME"
  ]) assert.ok(result.errors.some((entry) => entry.includes(fragment)), fragment);
  assert.ok(!JSON.stringify(result).includes(base.HRBP_MAINTENANCE_TOKEN));
});

test("warns when email events are configured but SMTP is disabled", () => {
  const result = validateOnpremEnv({
    ...base,
    HRBP_SMTP_ENABLED: "false",
    HRBP_NOTIFICATION_EMAIL_EVENTS: "HR_SERVICE_ESCALATED"
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.warnings.some((entry) => entry.includes("email mirroring is disabled")));
});


test("requires implicit TLS on the standard SMTPS port", () => {
  const result = validateOnpremEnv({
    ...base,
    HRBP_SMTP_ENABLED: "true",
    HRBP_NOTIFICATION_EMAIL_EVENTS: "HR_SERVICE_ESCALATED",
    HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED: "false",
    HRBP_NOTIFICATION_EMAIL_BATCH_SIZE: "5",
    HRBP_SMTP_HOST: "smtp.acme.internal",
    HRBP_SMTP_PORT: "465",
    HRBP_SMTP_SECURE: "false",
    HRBP_SMTP_USERNAME: "hrbp-smtp",
    HRBP_SMTP_PASSWORD: "smtp-password-abcdefghijklmnop",
    HRBP_SMTP_FROM: "HRBP <hrbp@acme.internal>"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes("must be true when HRBP_SMTP_PORT=465")));
});


test("accepts bounded document scanner configuration", () => {
  const result = validateOnpremEnv({
    ...base,
    DOCUMENT_SCANNER_IMAGE: "clamav/clamav:1.5.4-debian",
    DOCUMENT_UPLOAD_MAX_BYTES: "26214400",
    HRBP_DOCUMENT_SCAN_POLL_SECONDS: "10",
    HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS: "5",
    HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS: "30",
    HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS: "600",
    HRBP_DOCUMENT_SCAN_LOCK_MINUTES: "15",
    HRBP_DOCUMENT_SCAN_REQUEST_TIMEOUT_MS: "30000",
    HRBP_DOCUMENT_SCAN_MAX_BYTES: "26214400",
    HRBP_CLAMD_TIMEOUT_MS: "30000"
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects mutable scanner image and unsafe scan queue bounds", () => {
  const result = validateOnpremEnv({
    ...base,
    DOCUMENT_SCANNER_IMAGE: "clamav/clamav:latest",
    DOCUMENT_UPLOAD_MAX_BYTES: "26214400",
    HRBP_DOCUMENT_SCAN_POLL_SECONDS: "1",
    HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS: "25",
    HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS: "600",
    HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS: "30",
    HRBP_DOCUMENT_SCAN_LOCK_MINUTES: "1",
    HRBP_DOCUMENT_SCAN_REQUEST_TIMEOUT_MS: "1000",
    HRBP_DOCUMENT_SCAN_MAX_BYTES: "1024",
    HRBP_CLAMD_TIMEOUT_MS: "1000"
  });
  assert.equal(result.ok, false);
  for (const fragment of [
    "DOCUMENT_SCANNER_IMAGE",
    "HRBP_DOCUMENT_SCAN_POLL_SECONDS",
    "HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS",
    "RETRY_MAX_SECONDS",
    "LOCK_MINUTES",
    "REQUEST_TIMEOUT_MS",
    "SCAN_MAX_BYTES",
    "HRBP_CLAMD_TIMEOUT_MS"
  ]) assert.ok(result.errors.some((entry) => entry.includes(fragment)), fragment);
});
