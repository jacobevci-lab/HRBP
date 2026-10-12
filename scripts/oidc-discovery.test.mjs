import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

function loadAuthConfig(env = {}) {
  return load("lib/auth-config.ts", {
    "@/lib/runtime-env": {
      runtimeBoolean: (key, fallback) => Object.prototype.hasOwnProperty.call(env, key) ? env[key] === true || env[key] === "true" : fallback,
      runtimeString: (key) => Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined
    }
  });
}

function loadOidc() {
  const authConfig = loadAuthConfig();
  return load("lib/oidc.ts", {
    "@/lib/auth-config": authConfig,
    "jose": {
      createRemoteJWKSet: () => () => {},
      jwtVerify: async () => ({ payload: {} })
    }
  });
}

function metadata(issuer = "https://idp.example.test") {
  return {
    issuer,
    authorization_endpoint: "https://idp.example.test/oauth2/authorize",
    token_endpoint: "https://idp.example.test/oauth2/token",
    jwks_uri: "https://idp.example.test/oauth2/jwks",
    end_session_endpoint: "https://idp.example.test/logout"
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

test("OIDC discovery validates metadata, blocks redirects and caches only successful metadata", async () => {
  const oidc = loadOidc();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://idp.example.test/.well-known/openid-configuration");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return jsonResponse(metadata());
  };

  const first = await oidc.discoverOidc("https://idp.example.test/", fetchImpl);
  const second = await oidc.discoverOidc("https://idp.example.test", fetchImpl);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(first.issuer, "https://idp.example.test");
  assert.equal(first.token_endpoint, "https://idp.example.test/oauth2/token");
});

test("live OIDC probe bypasses discovery cache on every validation", async () => {
  const oidc = loadOidc();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(metadata("https://live.example.test"));
  };

  await oidc.probeOidcDiscovery("https://live.example.test", fetchImpl);
  await oidc.probeOidcDiscovery("https://live.example.test", fetchImpl);
  assert.equal(calls, 2);
});

test("OIDC validation freshness expires after 24 hours and rejects future-skewed evidence", () => {
  const oidc = loadOidc();
  const now = Date.parse("2026-10-09T21:00:00.000Z");
  assert.equal(oidc.oidcValidationCurrent(new Date(now - 60_000), now), true);
  assert.equal(oidc.oidcValidationCurrent(new Date(now - 24 * 60 * 60 * 1000), now), true);
  assert.equal(oidc.oidcValidationCurrent(new Date(now - 24 * 60 * 60 * 1000 - 1), now), false);
  assert.equal(oidc.oidcValidationCurrent(new Date(now + 60_001), now), false);
  assert.equal(oidc.oidcValidationCurrent(null, now), false);
});

test("transient discovery failure is evicted from cache so provider recovery is observed", async () => {
  const oidc = loadOidc();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return jsonResponse(metadata("https://recover.example.test"));
  };

  await assert.rejects(
    oidc.discoverOidc("https://recover.example.test", fetchImpl),
    /HTTP 503/
  );
  const recovered = await oidc.discoverOidc("https://recover.example.test", fetchImpl);
  assert.equal(calls, 2);
  assert.equal(recovered.issuer, "https://recover.example.test");
});

test("discovery rejects issuer substitution", async () => {
  const oidc = loadOidc();
  await assert.rejects(
    oidc.discoverOidc("https://issuer-a.example.test", async () =>
      jsonResponse(metadata("https://issuer-b.example.test"))
    ),
    /issuer does not match configured issuer/
  );
});

test("HTTPS issuers reject insecure discovered endpoints", async () => {
  const oidc = loadOidc();
  await assert.rejects(
    oidc.discoverOidc("https://secure.example.test", async () =>
      jsonResponse({
        issuer: "https://secure.example.test",
        authorization_endpoint: "https://secure.example.test/auth",
        token_endpoint: "http://secure.example.test/token",
        jwks_uri: "https://secure.example.test/jwks"
      })
    ),
    /invalid or insecure endpoint/
  );
});

test("discovery rejects oversized metadata before parsing", async () => {
  const oidc = loadOidc();
  await assert.rejects(
    oidc.discoverOidc("https://large.example.test", async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(256 * 1024), "content-type": "application/json" }
      })
    ),
    /too large/
  );
});

test("issuer configuration rejects credentials, query and non-http protocols", async () => {
  const oidc = loadOidc();
  await assert.rejects(oidc.discoverOidc("https://user:pass@example.test", async () => jsonResponse({})), /must use HTTPS/);
  await assert.rejects(oidc.discoverOidc("https://example.test?tenant=x", async () => jsonResponse({})), /must use HTTPS/);
  await assert.rejects(oidc.discoverOidc("file:///etc/passwd", async () => jsonResponse({})), /must use HTTPS/);
});


test("remote HTTP OIDC issuers are rejected before any discovery request is sent", async () => {
  const oidc = loadOidc();
  let calls = 0;
  await assert.rejects(
    oidc.discoverOidc("http://idp.example.test", async () => {
      calls += 1;
      return jsonResponse({});
    }),
    /must use HTTPS/
  );
  assert.equal(calls, 0);
});

test("loopback HTTP issuer remains available for local development only", async () => {
  const oidc = loadOidc();
  const issuer = "http://127.0.0.1:5556";
  const discovered = await oidc.probeOidcDiscovery(issuer, async (url) => {
    assert.equal(url, issuer + "/.well-known/openid-configuration");
    return jsonResponse({
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks"
    });
  });
  assert.equal(discovered.issuer, issuer);
  assert.equal(discovered.token_endpoint, issuer + "/token");
});

test("OIDC runtime configuration rejects insecure remote HTTP and normalizes secure issuers", () => {
  const common = {
    HRBP_OIDC_CLIENT_ID: "client-1",
    HRBP_AUTH_TENANT_ID: "tenant-1",
    HRBP_SESSION_SECRET: "s".repeat(48)
  };

  const insecure = loadAuthConfig({ ...common, HRBP_OIDC_ISSUER: "http://idp.example.test" });
  assert.equal(insecure.getOidcConfig(), null);
  assert.equal(insecure.authConfigurationStatus().configured, false);
  assert.ok(insecure.authConfigurationStatus().missing.some((entry) => entry.includes("HTTPS required")));

  const secure = loadAuthConfig({ ...common, HRBP_OIDC_ISSUER: "https://idp.example.test/" });
  assert.equal(secure.getOidcConfig()?.issuer, "https://idp.example.test");
  assert.equal(secure.authConfigurationStatus().configured, true);

  const loopback = loadAuthConfig({ ...common, HRBP_OIDC_ISSUER: "http://localhost:5556/" });
  assert.equal(loopback.getOidcConfig()?.issuer, "http://localhost:5556");
  assert.equal(loopback.authConfigurationStatus().configured, true);
});

test("OIDC issuer normalization rejects credentials, query, fragment and non-loopback HTTP", () => {
  const authConfig = loadAuthConfig();
  for (const value of [
    "https://user:pass@idp.example.test",
    "https://idp.example.test?tenant=x",
    "https://idp.example.test/#fragment",
    "http://10.0.0.5",
    "file:///etc/passwd"
  ]) {
    assert.equal(authConfig.normalizeOidcIssuer(value), null, value);
  }
});


test("authorization-code exchange blocks redirects, uses timeout and preserves PKCE/client binding", async () => {
  const oidc = loadOidc();
  const config = {
    issuer: "https://idp.example.test",
    clientId: "client-1",
    clientSecret: "client-secret-value",
    tenantId: "tenant-1",
    scopes: "openid profile email",
    allowedEmailDomains: ["example.test"],
    jitProvisioning: false
  };
  const result = await oidc.exchangeAuthorizationCode({
    config,
    metadata: metadata(),
    code: "authorization-code",
    verifier: "verifier-value",
    redirectUri: "https://hrbp.example.test/api/auth/callback",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://idp.example.test/oauth2/token");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      const body = options.body;
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("client_id"), "client-1");
      assert.equal(body.get("client_secret"), "client-secret-value");
      assert.equal(body.get("code"), "authorization-code");
      assert.equal(body.get("code_verifier"), "verifier-value");
      assert.equal(body.get("redirect_uri"), "https://hrbp.example.test/api/auth/callback");
      return jsonResponse({ id_token: "header.payload.signature", access_token: "opaque-access-token" });
    }
  });
  assert.equal(result.id_token, "header.payload.signature");
  assert.equal(result.access_token, "opaque-access-token");
});

test("authorization-code exchange rejects oversized token responses before JSON parsing", async () => {
  const oidc = loadOidc();
  await assert.rejects(
    oidc.exchangeAuthorizationCode({
      config: {
        issuer: "https://idp.example.test",
        clientId: "client-1",
        tenantId: "tenant-1",
        scopes: "openid profile email",
        allowedEmailDomains: [],
        jitProvisioning: false
      },
      metadata: metadata(),
      code: "authorization-code",
      verifier: "verifier-value",
      redirectUri: "https://hrbp.example.test/api/auth/callback",
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: { "content-length": String(128 * 1024), "content-type": "application/json" }
      })
    }),
    /token exchange response is too large/
  );
});

test("authorization-code exchange never echoes provider error descriptions", async () => {
  const oidc = loadOidc();
  const secretDescription = "sensitive upstream diagnostics must not reach logs";
  await assert.rejects(
    oidc.exchangeAuthorizationCode({
      config: {
        issuer: "https://idp.example.test",
        clientId: "client-1",
        tenantId: "tenant-1",
        scopes: "openid profile email",
        allowedEmailDomains: [],
        jitProvisioning: false
      },
      metadata: metadata(),
      code: "authorization-code",
      verifier: "verifier-value",
      redirectUri: "https://hrbp.example.test/api/auth/callback",
      fetchImpl: async () => jsonResponse({
        error: "invalid_grant",
        error_description: secretDescription
      }, { status: 400 })
    }),
    (error) => {
      assert.match(error.message, /invalid_grant/);
      assert.doesNotMatch(error.message, new RegExp(secretDescription));
      return true;
    }
  );
});

test("authorization-code exchange rejects invalid JSON and missing or oversized ID tokens", async () => {
  const oidc = loadOidc();
  const common = {
    config: {
      issuer: "https://idp.example.test",
      clientId: "client-1",
      tenantId: "tenant-1",
      scopes: "openid profile email",
      allowedEmailDomains: [],
      jitProvisioning: false
    },
    metadata: metadata(),
    code: "authorization-code",
    verifier: "verifier-value",
    redirectUri: "https://hrbp.example.test/api/auth/callback"
  };

  await assert.rejects(
    oidc.exchangeAuthorizationCode({
      ...common,
      fetchImpl: async () => new Response("{", { status: 200, headers: { "content-type": "application/json" } })
    }),
    /not valid JSON/
  );

  await assert.rejects(
    oidc.exchangeAuthorizationCode({
      ...common,
      fetchImpl: async () => jsonResponse({ access_token: "access-only" })
    }),
    /valid bounded ID token/
  );

  await assert.rejects(
    oidc.exchangeAuthorizationCode({
      ...common,
      fetchImpl: async () => jsonResponse({ id_token: "x".repeat(40000) })
    }),
    /valid bounded ID token/
  );
});
