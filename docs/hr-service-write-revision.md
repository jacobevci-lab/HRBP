# HR Service displayed-version writes

Status/routing and comment POST requests now require `expectedUpdatedAt`, copied
from the displayed request's canonical UTC `updatedAt` (millisecond ISO format).
Do not obtain a newer version silently at submission time. After a conflict the
user must read and review the new state before forming a new command.

- Missing precondition: 428 `SERVICE_REVISION_REQUIRED`.
- Malformed precondition: 400 `SERVICE_REVISION_INVALID`.
- Stale authorized record: 409 `SERVICE_REVISION_CONFLICT`.
- Authentication, origin, role and relationship scope remain authoritative. A
  timestamp does not grant access and a missing/foreign request stays unavailable.

The existing Serializable transactions compare the client revision to the scoped
record and conditionally update the same parent. Comments claim the parent before
inserting, including private notes, ordinary employee replies and subsequent staff
replies. Reopening/first-response changes share the same resulting version. Audit
and outbox failures roll back the version and domain changes together. Status and
maintenance writers also advance monotonically: `max(previous + 1 ms, clock)`.
Maintenance includes its sampled version in its compare-and-swap predicate.

All successful status/comment responses include `data.writeReceipt` with request,
tenant, actor, operation, expected and resulting revisions. Status receipts also
bind the normalized transition reason. The main action forms validate these fields
before clearing the submitted draft. The Action Center forwards the version from
its queue snapshot, rather than bypassing the new precondition.

The main forms retain their uncertain-result guard across record revision changes.
A refreshed prop does not silently rebind an unsent draft; explicit review is
required. A confirmed save permits the next action only once the server-rendered
version matches its receipt. A conflict preserves text in the mounted form; the
existing explicit full-page reload can discard that draft. No draft is placed in
persistent browser storage. The conversation dialog remains read-only.

## Compatibility and limits

This intentionally tightens the two POST contracts: older clients without the
precondition receive 428 and must upgrade. Ship the client/server changes together.
There is no database migration or new role permission. Only supported application
writers participate; direct/manual SQL updates must not reuse old timestamps.

This is optimistic concurrency, not durable command idempotency: a reused old
version is rejected, not replayed as success. The same text submitted intentionally
with a freshly reviewed version can be a new message. Revisions reveal a request
changed, but do not expose the content or count of private notes. Queue membership
revocation races and unified read/write conversation remain separate concerns.

## Verification

`node --test scripts/hr-service-revision.test.mjs scripts/hr-service-ui.test.mjs`
exercises contracts, actual handlers with transaction doubles and client version
binding. These are not real SQL tests. `hr-service-revision-browser.mjs` requires
the existing disposable localhost `hrbp_audit` database, signed synthetic sessions,
production Next.js and Chromium. It includes independent-tab contention, mixed
status/comment contention and a temporary synthetic audit-failure trigger which is
removed in `finally`. Never run that harness against customer data.
