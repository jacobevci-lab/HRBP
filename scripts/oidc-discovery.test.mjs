import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name === "jose") {
      return {
        createRemoteJWKSet: () => () => {},
        jwtVerify: async () => ({ payload: {} })
      };
    }
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
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
  const oidc = load("lib/oidc.ts");
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
  const oidc = load("lib/oidc.ts");
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
  const oidc = load("lib/oidc.ts");
  const now = Date.parse("2026-10-09T21:00:00.000Z");
  assert.equal(oidc.oidcValidationCurrent(new Date(now - 60_000), now), true);
  assert.equal(oidc.oidcValidationCurrent(new Date(now - 24 * 60 * 60 * 1000), now), true);
  assert.equal(oidc.oidcValidationCurrent(new Date(now - 24 * 60 * 60 * 1000 - 1), now), false);
  assert.equal(oidc.oidcValidationCurrent(new Date(now + 60_001), now), false);
  assert.equal(oidc.oidcValidationCurrent(null, now), false);
});

test("transient discovery failure is evicted from cache so provider recovery is observed", async () => {
  const oidc = load("lib/oidc.ts");
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
  const oidc = load("lib/oidc.ts");
  await assert.rejects(
    oidc.discoverOidc("https://issuer-a.example.test", async () =>
      jsonResponse(metadata("https://issuer-b.example.test"))
    ),
    /issuer does not match configured issuer/
  );
});

test("HTTPS issuers reject insecure discovered endpoints", async () => {
  const oidc = load("lib/oidc.ts");
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
  const oidc = load("lib/oidc.ts");
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
  const oidc = load("lib/oidc.ts");
  await assert.rejects(oidc.discoverOidc("https://user:pass@example.test", async () => jsonResponse({})), /valid HTTP/);
  await assert.rejects(oidc.discoverOidc("https://example.test?tenant=x", async () => jsonResponse({})), /valid HTTP/);
  await assert.rejects(oidc.discoverOidc("file:///etc/passwd", async () => jsonResponse({})), /valid HTTP/);
});
