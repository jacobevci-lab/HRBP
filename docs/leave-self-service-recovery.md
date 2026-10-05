# Leave self-service: confirmed outcomes and explicit recovery

## Scope
This slice changes the employee LeaveParticipantConsole and adds a dependency-free
client receipt checker. Existing authorization, tenant/employment scope,
serializable leave transactions, balance arithmetic, audit/outbox and API routes
are unchanged. Other write consoles are outside this slice.

Previously a 200 HTML page, empty body or malformed JSON could be treated as a
successful leave mutation because the UI checked only response.ok and replaced
JSON parse failures with an empty object. Fields remained editable in flight,
there was no same-turn submission lock, and uncertain transport failures allowed
immediate resubmission.

## New behavior
- A create requires HTTP 201 and a matching record: ID, employment, leave type,
  dates, quantity and PENDING/APPROVED status. Cancellation requires HTTP 200,
  the exact request/employment and CANCELLED status. A response mismatch is not
  success. This is client evidence checking, not a substitute for server policy.
- One ref-held lock covers create/cancel until the request settles, including
  same-event-loop duplicate submit events. Draft fields cannot be edited in flight.
- Structured, bounded expected 4xx errors keep the draft and show localized
  messages; arbitrary upstream error text is never copied into the notice.
- Missing receipts, redirects, unexpected success bodies, network failures,
  timeouts and 5xx responses leave the outcome unknown. The action is not retried,
  the draft is not reset, and further writes in this console are disabled until
  an explicit page reload. Reload discards unsaved inputs, as disclosed to the user.
- Confirmed writes reset only the submitted form. A subsequent synchronous router
  refresh error cannot turn that confirmed write into an apparent failed write.
  Confirmed cancellation buttons remain suppressed while the view refreshes.
- Unmount aborts the client request and ignores late UI updates. Changing the
  employment remounts the console so drafts/notices cannot cross that identity.
  Aborting a client request does not prove the server transaction was cancelled.
- Default request timeout is 20 seconds; receipt reads are bounded at 64 KiB.
  Only fixed same-origin endpoints are used. POST retries are never automatic.
- The existing recent-request limit of 50 is now disclosed, not removed. This
  work does not add pagination or a durable server-side idempotency key.

## Verification
`node --test scripts/leave-client-action.test.mjs` executes the actual helper and
component code using instrumented transports/hooks, including resource matching,
response bounds, malformed receipts, cancellation, timeout, double submit,
draft preservation, unmount and refresh-after-save behavior.

`node scripts/leave-browser-regression.mjs` is mandatory in Platform Regression
before the existing module/core/final gates. It uses real form login, the built
application and disposable PostgreSQL. EN desktop and TR mobile exercise normal
create/cancel, confirmed rejection and deliberately delayed or lost responses.
For HTML/lost-response cases the real API first commits the request; the test
then changes only the browser-facing transport response. Persisted request,
audit and exact balance values are checked, followed by explicit reload with no
POST replay. These are labelled fault-injection scenarios, not production faults.

All fixtures/writes are guarded by HRBP_DISPOSABLE_AUDIT=true, the fixed localhost
application and a loopback PostgreSQL database named hrbp_audit. Production data,
provider settings, dependencies, database schema and account permissions are not
modified. The browser suite is Chromium only and is not complete provider,
manager-approval, legal-entitlement or production load verification.

Unit success is not browser success. Inspect the head-specific CI and
.audit/leave-browser-regression.json before merge. A successful build does not
establish live Cloudflare rollout.
