import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks) {
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

const secret = "s".repeat(48);
const auth = load("lib/auth-session.ts", {
  "node:crypto": { createHash, createHmac, randomBytes, timingSafeEqual },
  "@prisma/client": { PlatformRole: { EMPLOYEE: "EMPLOYEE", TENANT_ADMIN: "TENANT_ADMIN" } },
  "@/lib/runtime-env": {
    runtimeNumber: (_key, fallback) => fallback,
    runtimeString: (key) => key === "HRBP_SESSION_SECRET" ? secret : undefined
  },
  "@/lib/safe-redirect": { sanitizeReturnTo: (value) => typeof value === "string" && value.startsWith("/") ? value : "/" }
});

function requestFromSetCookie(setCookie) {
  return new Request("https://hrbp.example.test/api/auth/callback", {
    headers: { cookie: setCookie.split(";")[0] }
  });
}

const baseTransaction = {
  state: "s".repeat(32),
  nonce: "n".repeat(32),
  verifier: "v".repeat(64),
  returnTo: "/module/people"
};

test("provider-bound OIDC transaction round-trips only with an id/version pair", () => {
  const cookie = auth.createOidcTransactionCookie({
    ...baseTransaction,
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  });
  const transaction = auth.readOidcTransaction(requestFromSetCookie(cookie));
  assert.equal(transaction?.v, 2);
  assert.equal(transaction?.identityProviderId, "idp-1");
  assert.equal(transaction?.identityProviderVersion, 7);
  assert.equal(transaction?.returnTo, "/module/people");
});

test("OIDC transaction rejects incomplete or invalid provider bindings", () => {
  for (const extra of [
    { identityProviderId: "idp-1" },
    { identityProviderVersion: 7 },
    { identityProviderId: "bad provider id", identityProviderVersion: 7 },
    { identityProviderId: "idp-1", identityProviderVersion: 0 }
  ]) {
    const cookie = auth.createOidcTransactionCookie({ ...baseTransaction, ...extra });
    assert.equal(auth.readOidcTransaction(requestFromSetCookie(cookie)), null);
  }
});

test("legacy transaction version is invalidated after provider binding rollout", () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = auth.encodeSignedPayload({ ...baseTransaction, v: 1, exp }, secret);
  const request = new Request("https://hrbp.example.test/api/auth/callback", {
    headers: { cookie: `hrbp_oidc_txn=${encodeURIComponent(token)}` }
  });
  assert.equal(auth.readOidcTransaction(request), null);
});

test("OIDC transaction rejects unsafe return targets even when signed", () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = auth.encodeSignedPayload({ ...baseTransaction, returnTo: "//evil.example", v: 2, exp }, secret);
  const request = new Request("https://hrbp.example.test/api/auth/callback", {
    headers: { cookie: `hrbp_oidc_txn=${encodeURIComponent(token)}` }
  });
  assert.equal(auth.readOidcTransaction(request), null);
});

test("OIDC login stamps the current governed provider generation into the transaction", async () => {
  let captured = null;
  const route = load("app/api/auth/login/route.ts", {
    "@/lib/auth-config": {
      getOidcConfig: () => ({
        issuer: "https://idp.example.test",
        clientId: "client-1",
        tenantId: "tenant-1",
        scopes: "openid profile email"
      })
    },
    "@/lib/auth-session": {
      createOidcTransactionCookie: (transaction) => {
        captured = transaction;
        return "hrbp_oidc_txn=test; Path=/; HttpOnly";
      },
      pkceChallenge: () => "challenge",
      randomToken: (bytes) => "x".repeat(bytes === 48 ? 64 : 32),
      sanitizeReturnTo: () => "/module/people"
    },
    "@/lib/db": { withDb: (operation) => operation({}) },
    "@/lib/oidc": {
      discoverOidc: async () => ({
        authorization_endpoint: "https://idp.example.test/authorize"
      })
    },
    "@/lib/runtime-identity-provider": {
      enforceOidcRuntimeBinding: async () => ({
        managed: true,
        connectionId: "idp-1",
        bindingVersion: 9
      })
    }
  });

  const response = await route.GET(new Request("https://hrbp.example.test/api/auth/login?returnTo=%2Fmodule%2Fpeople"));
  assert.equal(response.status, 302);
  assert.equal(captured.identityProviderId, "idp-1");
  assert.equal(captured.identityProviderVersion, 9);
  assert.equal(captured.returnTo, "/module/people");
});
