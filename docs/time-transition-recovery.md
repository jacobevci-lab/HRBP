# Time operating-view transition recovery

## Scope

`TimeEntryTransitionButtons` in the Time & Attendance operating view now uses
`lib/time-client-action.ts` for submission, approval, rejection and payroll locking.
Server APIs, schedule/overlap rules, relationship scope, self-approval denial,
approver-versus-locker separation, audit transactions and schema are unchanged.
The Action Center quick time actions and the separate employee draft/create/submit
console still use their existing clients; this slice does not claim to fix them.

## Receipt and recovery contract

The client sends one encoded, same-origin, no-store POST with redirects rejected.
A successful HTTP status alone is insufficient: HTTP 200, JSON content type,
matching entry ID and requested state, employment identity, dates and typed time
quantities are required. Approval/rejection and lock receipts require approval
metadata. Submitted receipts must clear earlier approval metadata. A rejection of
a legacy entry with invalid time quantities is accepted; the client does not
re-apply approval integrity rules to rejection.

Response reads have a 64 KiB byte limit, strict UTF-8 decoding and a 20-second
request/body deadline. A missing, malformed, redirected, oversized or late
response, HTTP 5xx or network loss is UNKNOWN, not evidence of rollback. No POST
is automatically retried. Only bounded, structured 4xx error envelopes are treated
as rejection; arbitrary server error text and record details are not displayed.

Each row synchronously locks before confirmation and before sending. Dismissing
confirmation unlocks without a write. Every attempted transition seals the row
until explicit page reload, even on conflict. A router refresh cannot expose the
next transition on the same mounted row. Reload discards unsaved page input and
never replays a transition. Buttons have explicit type=button and EN/TR copy.
The lock is component-local, not durable cross-tab or server-side idempotency.

Notification acknowledgement runs only after a verified approval/rejection and
is separately bounded to 5 seconds with count-receipt validation. It cannot turn
a saved transition into a failed one. Submission and lock do not clear approval
notifications. Unmount aborts in-flight write/read and badge cleanup; late results
do not refresh or mutate another row.

## Verification

Run `node --test scripts/time-transition.test.mjs` for actual TS helper/component
behavior with controlled transport/hooks. Local execution passed 90 cases before
PR creation; this is not real-browser or production evidence.

Platform Regression adds `node scripts/time-transition-browser-regression.mjs`
as a mandatory stage. It requires flagged disposable localhost PostgreSQL
`hrbp_audit` and ephemeral local-login credentials. Tests log in as manager and HR
operations in EN desktop/TR mobile, let the real API commit before introducing
browser-response failures, and verify status, audit counts, worked/overtime
quantities, notifications, no replay and recovery. Other scenarios exercise real
schedule conflicts, stale state, self-approval denial, operational submission,
same-actor lock denial and independent HR locking after actual manager approval.
The output is `.audit/time-transition-browser.json` with tested revision and scope.

All pre-existing stages and final gates remain. Audit artifacts now retain
`git archive HEAD` of tracked tested source for reproducibility; untracked runtime
files, environment secrets, database contents and `.git` are not included in that
source archive. Existing artifact access and 7-day retention remain unchanged.

Passing CI/Worker smoke tests or merging the PR does not establish live Cloudflare
rollout. Verify the provider deployment separately; no production data or provider
configuration is changed by these tests.
