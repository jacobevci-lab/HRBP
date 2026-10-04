# Native download request verification — 4 October 2026

Baseline: PR #95 head b776c38; regression #17 saved a valid filtered Audit CSV
but failed `page.on('request')` count (zero rather than one). A saved download
is not proof that this page-scoped network observer is complete.

## Observation, not an application workaround

The production app and export route are unchanged by this follow-up. Only the
isolated Node test server is launched with `audit-download-observer.cjs`. It
passively records receipt of `/api/audit/export` and the runtime health probe
before dispatching the original HTTP event unchanged. It does not read bodies,
rewrite headers/responses, suppress requests, retry writes or replace downloads.
Remote/non-audit database settings are rejected; the hook is not part of any
application deployment/build entrypoint. Receipt records contain sequence,
process and worker-thread identifiers, method, path, a hash of the target, and
prefetch/RSC flags. No cookie, bearer token, body or plaintext filter value is
recorded. Evidence is bounded at 1 MiB and append-only within a test window;
missing, reset, truncated, duplicated or reordered receipt records fail
validation. A real health receipt is required before any zero-export assertion.

The browser test retains the page-request observer as diagnostic information.
Its exactly-one-request gate now uses actual server receipts, plus exactly one
Download event, the expected URL, real CSV bytes/content, filter preservation,
six natural locale transitions, draft retention, identity continuity and
anonymous export rejection. Both before navigation/hover and after filtering,
zero actual export requests must have reached the server. Prefetch and RSC
export requests remain failures. No existing business or browser assertion is
skipped to obtain a green run.

## Independent calibration and negative tests

Before building the application, the workflow uses its pinned Playwright and
Chromium to exercise a standalone HTTP fixture with both native `download`
anchors and regular attachment navigation, with/without the same pass-through
routing used by the application audit. Server counts, page/context request
events and Download events are recorded separately. This experiment must finish
all four cases. It establishes the behavior of the installed test/browser
combination; it is not an assumption that all Playwright versions behave alike.

Eight Node test results include actual loopback HTTP receipt and response
checks, deliberate duplicate/prefetch failures, no-secret logging, worker-thread
preload isolation and rejection of remote/non-disposable databases. They do not
substitute for the real-browser calibration or the complete app regression.
The model-container browser denied loopback navigation, so no local browser
success is claimed; the existing GitHub Actions runner performs those checks.

The focused render regression retains a bounded failure stack to identify the
failed assertion unambiguously. Final evidence belongs to the exact head and
workflow run. Prior successful broad sweeps cannot be relabelled as current
passes if a preceding test fails. No production rollout, external-provider
validation, full feature parity or performance/load sign-off is implied.

## Calibration result and observer follow-up

Run 37228338975 / artifact 11312508765 (SHA256
8e46136c3347022896e5d615b86ae376eda712b7ba53f21943e22a4275b15162)
completed all four standalone browser cases. Native download anchors produced
one server request and one Download event, but zero page AND context request
events. Regular attachment navigation produced one of each. The result was
the same with and without pass-through routing. This reproduces the request
observer blind spot independently of HRBP, without changing the browser version.

That first application run then failed before the Audit case because the
preload also started inside a worker thread: the same process ID began another
sequence. The collector now keys sequences by process AND worker-thread ID;
a real Worker preload regression reproduces and verifies that distinction.
The original per-writer ordering/reset checks remain strict. This was a test
instrumentation issue, not a newly discovered application failure. Full
application regression must pass on the follow-up head before release.
