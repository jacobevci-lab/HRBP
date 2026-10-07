import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const IdentityProviderType = {
  ENTRA_ID: "ENTRA_ID",
  OKTA: "OKTA",
  OIDC: "OIDC",
  SAML: "SAML",
  LDAP: "LDAP",
  LOCAL: "LOCAL"
};

function load(path, mocks = {}) {
  const source = readFileSync(path, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0, path);
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputText)(
    (name) => name in mocks ? mocks[name] : require(name),
    module,
    module.exports
  );
  return module.exports;
}

const input = load("lib/input-validation.ts");
const connectionValidation = load("lib/settings-connection-validation.ts", {
  "@prisma/client": { IdentityProviderType },
  "@/lib/input-validation": input
});
const live = load("lib/identity-provider-live-validation.ts", {
  "@prisma/client": { IdentityProviderType }
});

function connection(overrides = {}) {
  return {
    type: IdentityProviderType.OIDC,
    issuer: "https://idp.example.test",
    metadataUrl: null,
    clientId: "client",
    directoryTenantId: null,
    secretRef: "vault://identity/client",
    ...overrides
  };
}

test("identity metadata endpoints require encryption and reject embedded credentials/hash", () => {
  assert.equal(connectionValidation.identityIssuer("http://idp.example.test", IdentityProviderType.OIDC), null);
  assert.equal(connectionValidation.identityIssuer("ldap://directory.example.test", IdentityProviderType.LDAP), null);
  assert.equal(connectionValidation.identityIssuer("ldaps://directory.example.test", IdentityProviderType.LDAP), "ldaps://directory.example.test/");
  assert.equal(connectionValidation.identityMetadataUrl("http://idp.example.test/metadata"), null);
  assert.equal(connectionValidation.identityMetadataUrl("https://user:pass@idp.example.test/metadata"), null);
  assert.equal(connectionValidation.identityMetadataUrl("https://idp.example.test/metadata#fragment"), null);
});

test("OIDC live validation verifies discovery issuer, secure endpoints and non-empty JWKS", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/.well-known/openid-configuration")) {
      return new Response(JSON.stringify({
        issuer: "https://idp.example.test",
        authorization_endpoint: "https://idp.example.test/authorize",
        token_endpoint: "https://idp.example.test/token",
        jwks_uri: "https://idp.example.test/jwks"
      }), { headers: { "content-type": "application/json" } });
    }
    if (String(url) === "https://idp.example.test/jwks") {
      return new Response(JSON.stringify({ keys: [{ kty: "RSA", kid: "one" }] }), {
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await live.validateIdentityProviderLive(connection(), { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.code, "OIDC_LIVE_VALIDATED");
  assert.equal(result.evidence.jwksKeyCount, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.redirect === "error"));
});

test("OIDC validation fails closed on issuer mismatch and unsafe discovery endpoints", async () => {
  const mismatch = await live.validateIdentityProviderLive(connection(), {
    fetchImpl: async () => new Response(JSON.stringify({
      issuer: "https://other.example.test",
      authorization_endpoint: "https://idp.example.test/authorize",
      token_endpoint: "https://idp.example.test/token",
      jwks_uri: "https://idp.example.test/jwks"
    }))
  });
  assert.deepEqual(mismatch, { ok: false, code: "OIDC_ISSUER_MISMATCH" });

  const unsafe = await live.validateIdentityProviderLive(connection(), {
    fetchImpl: async () => new Response(JSON.stringify({
      issuer: "https://idp.example.test",
      authorization_endpoint: "http://idp.example.test/authorize",
      token_endpoint: "https://idp.example.test/token",
      jwks_uri: "https://idp.example.test/jwks"
    }))
  });
  assert.deepEqual(unsafe, { ok: false, code: "OIDC_DISCOVERY_ENDPOINTS_INVALID" });
});

test("identity live validation blocks loopback and link-local metadata targets before fetch", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response("{}");
  };
  for (const issuer of [
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://metadata.google.internal"
  ]) {
    const result = await live.validateIdentityProviderLive(connection({ issuer }), { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.code, "OIDC_ISSUER_INVALID");
  }
  assert.equal(called, false);
});

test("SAML metadata requires safe XML and an HTTPS SSO endpoint", async () => {
  const valid = await live.validateIdentityProviderLive(connection({
    type: IdentityProviderType.SAML,
    issuer: null,
    clientId: null,
    secretRef: null,
    metadataUrl: "https://saml.example.test/metadata"
  }), {
    fetchImpl: async () => new Response(
      '<EntityDescriptor entityID="urn:test"><IDPSSODescriptor><SingleSignOnService Binding="urn:test" Location="https://saml.example.test/sso"/></IDPSSODescriptor></EntityDescriptor>',
      { headers: { "content-type": "application/xml" } }
    )
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.code, "SAML_METADATA_LIVE_VALIDATED");

  const unsafe = await live.validateIdentityProviderLive(connection({
    type: IdentityProviderType.SAML,
    issuer: null,
    clientId: null,
    secretRef: null,
    metadataUrl: "https://saml.example.test/metadata"
  }), {
    fetchImpl: async () => new Response('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><EntityDescriptor/>')
  });
  assert.deepEqual(unsafe, { ok: false, code: "SAML_METADATA_UNSAFE_XML" });
});

test("LDAP cannot be falsely marked live-validated before the on-prem validation agent exists", async () => {
  const result = await live.validateIdentityProviderLive(connection({
    type: IdentityProviderType.LDAP,
    issuer: "ldaps://directory.example.test",
    clientId: null,
    directoryTenantId: null
  }));
  assert.deepEqual(result, { ok: false, code: "LDAPS_LIVE_VALIDATION_AGENT_REQUIRED" });
});

test("LOCAL provider validation is runtime-managed without network access", async () => {
  const result = await live.validateIdentityProviderLive(connection({
    type: IdentityProviderType.LOCAL,
    issuer: null,
    clientId: null,
    directoryTenantId: null,
    secretRef: null
  }));
  assert.equal(result.ok, true);
  assert.equal(result.code, "LOCAL_RUNTIME_MANAGED");
});
