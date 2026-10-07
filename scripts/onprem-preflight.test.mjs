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
