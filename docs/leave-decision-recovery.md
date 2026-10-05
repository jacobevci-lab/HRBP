# Leave decision receipts and recovery

## Scope

Manager/HR leave approval controls now use the existing bounded leave client
transport. This is client recovery and UI honesty, not a new authorization layer
or a change to approval, balance, audit, notification creation or schema rules.
The decision API remains authoritative for tenant, employment scope, self-approval,
concurrency and balance constraints.

## Behavior

Approve and Reject require explicit confirmation. A synchronous per-record lock
prevents opposite/same-turn duplicate clicks before React rerenders. Buttons have
explicit non-submit types and localized EN/TR labels.

A saved decision requires HTTP 200 and a JSON receipt with the exact request ID,
exact requested APPROVED/REJECTED state, valid employment/approver identifiers and
a parseable decision timestamp. Identity/authorization is not established by this
receipt; the existing signed-session API establishes it. No bearer token or raw
response text is displayed. The shared 20-second request/body deadline, 64 KiB
UTF-8 response bound, same-origin credentials and redirect rejection remain active.

Rejected or uncertain decisions do not mark the notification read. The row stays
sealed until an explicit page reload retrieves current state; an insufficient
balance or stale-state conflict is not permission to automatically submit the
opposite decision. Unknown outcomes may already have committed. Reload preserves
the current URL but discards unsaved page input, as disclosed. It sends no decision
POST. There is no cross-tab/durable idempotency-key guarantee in this client code.

A verified decision is displayed independently of notification cleanup and view
refresh. Best-effort notification acknowledgement is now bounded to five seconds,
requires a structured count response, and never replays the decision. If cleanup
fails, the unread badge can remain until separately refreshed/acknowledged; the
accepted decision is not reported as failed. If a row unmounts before its receipt,
its HTTP request is aborted and late callbacks cannot affect a new record. A
request-ID-keyed child owns locks, avoiding state carryover between records.

## Verification

`node --test scripts/leave-decision.test.mjs` executes actual TypeScript helpers
and the component with instrumented network/hooks. It covers exact receipts,
wrong/partial/HTML responses, byte bounds, abort, confirmation, opposite clicks,
notification isolation, sealed conflicts, unmount and explicit reload.

`node scripts/leave-decision-browser-regression.mjs` is a mandatory Platform
Regression stage, after identity preparation and before the unchanged prior
leave, generic, core and final gates. It refuses targets other than fixed localhost
and flagged disposable loopback PostgreSQL `hrbp_audit`. It uses real form login
for MANAGER and a synthetic HR_OPERATIONS account. Requests, balances and unread
notification fixtures are seeded only into that disposable database.

The browser scenarios run EN desktop and TR mobile for both roles. Delayed,
HTML-after-commit, lost-after-commit and notification-failure cases are explicit
transport fault injections. Decisions still execute through the real unchanged
API; database status, balance, audit count and notification read state are checked.
The original employee self-service and leave API suites remain required.

Local tests do not constitute real browser/database evidence. Full-head CI and
Platform Regression must pass before merge. Production deployment, every manager
console/Action Center surface, specialist role, browser engine, legal entitlement,
external provider and production concurrency/load remain outside this slice.
The separate Cloudflare provider-build issue is not addressed here.
