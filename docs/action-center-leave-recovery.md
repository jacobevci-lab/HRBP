# Action Center: confirmed leave decisions and safe review

## Scope

Action Center previously had separate approve/reject fetch code that accepted
HTTP success without checking the saved decision record. That code could also
acknowledge a notification without a valid decision receipt. Leave queue actions
now use the existing LeaveDecisionButtons and bounded leave-client-action
transport instead. The API remains authoritative for identity, relationship
scope, self-approval prohibition, state transitions, balance, audit and outbox.
No handler, schema or server policy is changed by this slice.

The queue adapter exposes only the approve/reject actions actually supplied for
one matching leave request. Missing, malformed, mixed-kind or conflicting action
metadata does not create mutation authority: a leave-like row falls back to its
existing Open link, and both generic mutation handlers reject such a row.
Non-leave quick-action implementations retain their existing behavior. The small
English offer-return confirmation copy change does not change its action.

## Review barrier

The parent Action Center owns an in-memory map of attempted leave IDs/results.
After user confirmation and before the first write is sent, a record is marked
unknown. The shared component then uses the verified response result. A failed
or missing acknowledgement never means rollback and never authorizes an
automatic opposite decision. Unknown/rejected results do not mark notifications
read. A confirmed result remains confirmed if independent badge cleanup fails.

Filtering a row out and back, a queue refresh, or a delayed pre-decision queue
snapshot does not clear the map. If a component is removed while its request is
pending, cancellation suppresses late UI updates and the parent retains an
unknown outcome for fresh review. Two mounted representations of the same ID
consult the same map before sending. Other IDs are independent.

The optional map is not required by the existing leave-module screen, which
retains its original default approve/reject controls. Allowed-action and
external-disabled props restrict the Action Center surface. Leave controls are
disabled while its queue is loading, after a read error, or while another
legacy quick action is busy.

The row's explicit Reload and review performs a page reload without resending a
decision. It preserves the URL, not unsaved page input. The header Refresh only
reloads queue data and intentionally does not clear attempted IDs.

This is not durable cross-tab/server idempotency. The map is discarded on full
navigation/reload and its contents are not stored remotely. Existing server
transactions/state guards remain the last line of defense. General queue JSON
validation, stale reads for unattempted records and other action types are not
redesigned here.

## Verification

`node --test scripts/action-center-leave.test.mjs` executes the actual adapter,
shared component and parent using instrumented transport/hooks. It checks action
subsets, invalid IDs, remounts, duplicate representations, in-flight cancellation,
EN/TR recovery, explicit reload and actual parent-to-component delegation.
These unit fixtures are not real browser/database evidence.

The existing mandatory Chromium/HTTP/PostgreSQL decision regression runs twice:

```
node scripts/leave-decision-browser-regression.mjs
HRBP_LEAVE_DECISION_SURFACE=action-center node scripts/leave-decision-browser-regression.mjs
```

The default module run retains its original scenarios and output filename.
Action Center mode writes `.audit/leave-action-center-browser.json`, exercises
MANAGER and synthetic HR_OPERATIONS in EN desktop/TR mobile, and adds search
remount, stale-snapshot, failed-read and conflicting-ID checks. Response-loss
cases first let the actual API commit, then replace/drop only the browser-facing
response; database state, balance, audit count, notification and POST counts are
checked. All mutations are confined to fixed localhost and flagged disposable
PostgreSQL `hrbp_audit`; no production fixture or external provider is used.

A passing CI or regression run does not establish Cloudflare live rollout, all
Action Center transactions, external SSO/notifications or production load safety.
The unrelated provider build failure requires separate evidence and resolution.
