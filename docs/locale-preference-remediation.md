# Server-owned locale updates — 4 October 2026

## Reproduction

PR #95 head 1144636 / diagnostic head 4dcce6a, run 37193438383,
artifact 11299239306. Without suppressing any application request, the actual
local sign-in form and repeated TR/EN/TR transitions reproduced a mismatch:
client selection, document language, localStorage and cookie were Turkish,
while the visible Audit root and heading remained English. The third natural
transition and the first/third seed-once transitions failed. The element was
visible with a nonzero bounding box. This is not a display-contents condition,
a missing marker, or proof that unconditional test initialization was the cause.

The previous provider wrote the browser cookie and separately called
router.refresh. The replacement commits the allowlisted preference in a Next
Server Action, allowing its cookie write and server-tree update to share the
same response. UI selection/storage follow the successful acknowledgement.
Pending controls and an immediate ref guard prevent overlapping user changes;
a failed commit retains the old selection and offers an explicit retry. No
full-page reload, auth bypass, test request suppression or increased timeout
is used as a workaround. The cookie is cosmetic, not an authentication token.

The cookie is authoritative over stale localStorage in both client hydration
and the document bootstrap. Storage-denied browsers still use the cookie and
can update the DOM. First-time browser preferences also reach the server.

## Verification contract

27 new tests execute the action, preference helpers and provider with mocked
cookie storage/React scheduling, including invalid input, failed commits,
concurrent requests, storage errors and first-time initialization. Together
with the previous 64 auth/render helpers: 91 passing local tests. These mocks
do not substitute for real Next rendering or browser tests.

The natural Chromium Audit regression now repeats six EN/TR transitions,
asserts real server locale AND heading, keeps an unsaved filter draft, verifies
DOM/storage/cookie agreement and reload persistence, then exercises the actual
filtered CSV download. Existing broad browser/API/role gates and twelve
workflow viewport combinations remain enabled. The test preference initializer
only fills absent storage keys so it does not reset a user's later choice.
Final head-specific Actions results belong in PR #95; a collected artifact or
local unit pass alone is not release verification.

Temporary locale diagnostic source/workflow are removed from the final patch.
No schema, production secrets, customer data or provider configuration changes.
All earlier session-reset and external-provider/load-testing boundaries in
platform-audit-remediation.md still apply.

## Follow-up after the first real-browser trial

At cdfdbdd, CI #1011 passed, but Platform Regression #16 (37194158591,
artifact 11300960305) still failed the Audit TR marker and recorded stalled
pending controls on several pages. The server-action change alone was not a
verified resolution. No merge or success override was performed.

A feature-scoped progress update now runs outside the suspended transition,
every 250 ms while locale is pending, for at most five seconds. It renders a
small elapsed-time indicator and lets React retry pending work; translation
functions stay stable between progress ticks. Timers are cleared on settle or
unmount. This is an explicit bounded compatibility mitigation, not an upstream
framework patch: it never retries the server action, reloads the page, changes
server markers, suppresses requests, or reports a timeout as success. The same
10-second server-heading check and six draft-preserving transitions must pass.

Similar suspended-commit behavior and an urgent-render mitigation are reported
upstream at https://github.com/vercel/next.js/issues/96233. That report is not
proof of an identical internal cause in HRBP. Retain the real production-build
regression when reviewing/removing this compatibility step after a framework
upgrade. There is no claim of a general fix for every RSC or network failure.

The focused real Audit/download/layout regression now runs before the broad
sweeps to fail early; no check is removed. Three scheduling/cleanup tests with
mocked timers supplement, rather than replace, the real browser gate.
