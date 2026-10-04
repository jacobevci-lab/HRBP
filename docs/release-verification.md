# Identify the deployed revision without confusing liveness with release success

## Evidence and limits

On 4 October 2026, main `aa7c033` passed its GitHub CI and Platform Regression,
but Cloudflare check `111516860877` failed (build
`f5210be6-374e-4034-ba64-aef6f6d4dbed`). Its GitHub output exposed no root-cause
log. The prior public runtime health response had no source revision, so a 200
response could not distinguish an old Worker from the newly merged application.
This patch fixes that observability gap; it does not claim to repair the
unavailable provider build log, billing, permissions or dashboard configuration.

## Build and response contract

`next.config.ts` embeds only `HRBP_BUILD_REVISION`, a public full commit SHA,
using `scripts/build-revision.cjs`. A clean Git checkout is authoritative;
Cloudflare's `WORKERS_CI_COMMIT_SHA` and GitHub's `GITHUB_SHA`, when present,
must be valid and agree with the checkout. A source archive without Git may
use its CI declaration. Missing identity or dirty/unreadable tracked state is
`unknown`, never a made-up revision. This is a build label, not cryptographic
artifact attestation or proof of dependency reproducibility; untracked local
files are outside the tracked-dirty check. Build only reviewed clean sources.

`GET /api/health/runtime` preserves its existing liveness fields and adds a
versioned release object, a validated random probe echo and an explicit
`runtime-and-release-only` scope. Unknown revisions are returned as null.
The historical `runtime` field remains the configured deployment target, not
a runtime-host detector. The handler initializes no database, performs no
account/maintenance operation and exposes no binding, credential or employee
information. A 200 means this handler runs, not that all dependencies work.

Only the non-secret revision is passed to Next's build-time env option. Never
spread `process.env` there. Reusing an already-built artifact preserves its
embedded revision; changing a runtime environment variable cannot relabel it.

## Verification

The `Release Verification` workflow runs 44 dependency-free tests on PRs and
main. On **manual workflow_dispatch only**, its live job targets the fixed
`https://hrbp.fornostsecurity.com` origin and compares the requested full SHA
(or the workflow commit) with the live response. It makes one anonymous GET:
no login, no cookies/tokens, no POST, no retries, no redirects and no production
writes. Arbitrary host input is not exposed in the hosted workflow.

The same checker runs against the built local Cloudflare Worker in the existing
maintenance smoke test. This tests the actual packaged/inlined revision, not
just a helper imported into Node. Full existing maintenance assertions remain.

The checker requires HTTP 200, HRBP's release contract, the exact revision,
no-store and a matching unpredictable probe. Reads are bounded to 8 KiB and
10 seconds by default (including the body). HTML challenge/login responses,
unknown revisions, old deployments and stale cached responses cannot pass.
The summary contains only safe diagnostic codes and normalized revisions.

| Diagnostic | Meaning |
| --- | --- |
| REVISION_MATCH | One runtime response identified the expected build; DB/providers/business flows remain unverified. |
| REVISION_MISMATCH | The responding instance identified a different revision. |
| RELEASE_PROTOCOL_UNAVAILABLE | The response lacks this contract, potentially an older deployment. |
| RELEASE_UNIDENTIFIED | The server cannot identify a valid build revision. |
| FRESH_RESPONSE_UNCONFIRMED | Probe/cache policy did not establish a fresh response. |
| ACCESS_BLOCKED | HTTP 401/403; inspect the access policy without weakening it. |
| REACHABILITY_UNCONFIRMED / TIMEOUT | This probe could not establish reachability; do not infer a global outage. |
| HTTP_FAILURE / INVALID_RESPONSE / UNEXPECTED_CONTENT_TYPE | Inspect provider/HTTP diagnostics; no raw body is written into the log. |

A failed check does not deploy, roll back, raise limits, mutate secrets or
weaken access controls. Obtain the exact Cloudflare build log for the failed
build before changing provider settings. After an actual deployment, rerun
against that commit, then separately verify authorized login, database and
provider workflows. A single revision match is not global rollout convergence.

Official references used for the build integration:
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#default-variables
- https://nextjs.org/docs/app/api-reference/config/next-config-js/env
