import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runtimeHealth } from "../lib/runtime-health.mjs";
import { postflightReleaseRequirement, verifyPostflightRelease } from "./onprem-pilot-release.mjs";

const sha = "a".repeat(40);
const wrong = "b".repeat(40);
const challenge = "c".repeat(32);
const origin = "http://127.0.0.1:3000";

function scenario({ revision = sha, echoedChallenge = challenge, cacheControl = "no-store",
  protocolVersion = 1, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    const body = runtimeHealth(revision, echoedChallenge);
    body.release.protocolVersion = protocolVersion;
    return Response.json(body, { status, headers: { "cache-control": cacheControl } });
  };
  return { fetchImpl, calls };
}

test("pilot mode fails before network/docker work without a full approved commit", () => {
  assert.throws(() => postflightReleaseRequirement({ mode: "post-deploy", pilot: true }), /approved release SHA/);
  assert.throws(() => postflightReleaseRequirement({ mode: "pre-upgrade", pilot: true, expectedRevision: sha }), /post-deploy/);
  for (const value of ["", "abcd", "z".repeat(40), "a".repeat(41), " " + sha, [sha], { sha }]) {
    assert.throws(() => postflightReleaseRequirement({ mode: "post-deploy", pilot: true, expectedRevision: value }));
  }
  assert.deepEqual(postflightReleaseRequirement({ mode: "post-deploy", pilot: true, expectedRevision: sha.toUpperCase() }),
    { expectedRevision: sha, pilot: true });
  assert.deepEqual(postflightReleaseRequirement({ mode: "post-deploy" }), { expectedRevision: null, pilot: false });
  assert.throws(() => postflightReleaseRequirement({ mode: "unknown" }), /mode/);
});

test("approved on-prem release requires exact SHA, fresh challenge and no-store", async () => {
  const run = scenario();
  const result = await verifyPostflightRelease({ origin, expectedRevision: sha, fetchImpl: run.fetchImpl, nonce: () => challenge });
  assert.deepEqual(result, { verified: true, code: "REVISION_MATCH", revision: sha });
  assert.equal(run.calls.length, 1);
  const request = run.calls[0];
  const url = new URL(request.url);
  assert.equal(url.pathname, "/api/health/runtime");
  assert.equal(url.searchParams.get("probe"), challenge);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.headers.Cookie, undefined);
});

for (const [caseName, options, expectedCode] of [
  ["wrong running commit", { revision: wrong }, "REVISION_MISMATCH"],
  ["missing build identity", { revision: null }, "RELEASE_UNIDENTIFIED"],
  ["stale cached probe", { echoedChallenge: "d".repeat(32) }, "FRESH_RESPONSE_UNCONFIRMED"],
  ["caching allowed by response", { cacheControl: "public,max-age=60" }, "FRESH_RESPONSE_UNCONFIRMED"],
  ["mismatched release protocol", { protocolVersion: 2 }, "RELEASE_PROTOCOL_UNAVAILABLE"],
  ["failed HTTP health", { status: 503 }, "HTTP_FAILURE"]
]) {
  test("pilot release fails closed for " + caseName, async () => {
    const run = scenario(options);
    const result = await verifyPostflightRelease({
      origin, expectedRevision: sha, fetchImpl: run.fetchImpl, nonce: () => challenge
    });
    assert.equal(result.verified, false);
    assert.equal(result.code, expectedCode);
    assert.equal(run.calls.length, 1);
  });
}

test("release verifier cannot be pointed at customer network or external sites", async () => {
  for (const unapproved of [
    "https://hrbp.example/", "http://10.0.0.1:3000", "http://169.254.169.254",
    "http://localhost:3000", "http://127.0.0.1:3000/pivot",
    "http://admin:secret@127.0.0.1:3000"
  ]) {
    let called = false;
    await assert.rejects(verifyPostflightRelease({
      origin: unapproved,
      expectedRevision: sha,
      fetchImpl: async () => { called = true; throw Error("network"); }
    }), /loopback/);
    assert.equal(called, false);
  }
});

test("postflight pilot wiring and report explicitly distinguish release check from UAT", () => {
  const postflight = readFileSync("scripts/onprem-postflight.mjs", "utf8");
  assert.match(postflight, /args\[index\] === "--pilot"/);
  assert.match(postflight, /postflightReleaseRequirement\(\{ mode, pilot, expectedRevision \}\)/);
  assert.match(postflight, /verifyPostflightRelease\(\{ origin, expectedRevision \}\)/);
  assert.match(postflight, /if \(!proof\.verified\) fail/);
  assert.match(postflight, /approvedRevisionVerified/);
  const docs = readFileSync("docs/PILOT-ACCEPTANCE.md", "utf8");
  assert.match(docs, /onprem:pilot:postflight/);
  assert.match(docs, /NOT evidence of completed customer testing/);
});
