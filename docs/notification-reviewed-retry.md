# Explicit, reviewed notification retry

The retry endpoint no longer interprets missing, malformed or non-string `id`
values as permission to run a dead-letter batch. The wire contract is deliberately
incompatible with old `{id}` / `{limit}` callers; deploy the updated UI with the
server. Old tabs fail with 400, never silently retry a wider set.

POST `/api/settings/notifications/retry` accepts exactly `commandId`, `mode` and
`items`. `mode` is `SINGLE` (one FAILED/DEAD_LETTER snapshot) or
`DEAD_LETTER_BATCH` (1–100 explicitly reviewed DEAD_LETTER snapshots). Each item
carries its id, status, attempts and canonical UTC updatedAt. A UUIDv4 correlates
the response; it is neither authorization nor a durable idempotency key.

The server retains settings:write, origin and tenant checks. A Serializable
transaction reads the selected rows, compares every snapshot, conditionally
updates only matching rows, and appends one audit only after the complete claim.
A missing row returns 404. Any changed member or serialization conflict returns
409 without committing a subset or a no-op success audit. Audit failure rolls
back the requeue. There is no automatic server retry. This follows Prisma's
optimistic-concurrency transaction model; see the v6 transaction documentation:
https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions

The batch UI first reads and previews exact records; newly arriving dead letters
are not implicitly added. Confirmation warns that retrying an externally
uncertain send may duplicate a message. Successful feedback means PENDING, not
sent, SMTP accepted, inbox delivered, or reconciled.

Operations reads use a same-tenant RepeatableRead snapshot, an allowlisted server
status filter, deterministic bounded order, and private/no-store success/error
responses. Counters are tenant totals, not the limited list length. Raw historic
lastError strings are mapped to allowlisted diagnostics or a redacted marker;
the original database error/payload is not rewritten. Payloads, recipients and
dedupe keys are not projected. Stale/failed/foreign-viewer reads hide old rows.

The mounted retry hook gates same-turn calls and validates the exact command,
actor, tenant, count and PENDING result. Unknown results remain guarded across
explicit reads or preview close/reopen. Its bounded history holds at most 32
commands, each with up to 100 row ids and a phase, never payloads or diagnostics.
Full reload/unmount resets it; this is not cross-device durable deduplication.
The separate single and batch controls do not share a global in-memory lock;
server snapshot comparison remains authoritative. No dispatcher, mail transport,
notification-delivery reconciliation, schema, privilege grants or provider
configuration was changed.

Tests: `node --test scripts/notification-retry.test.mjs` runs controlled handler,
contract and hook cases. `scripts/notification-retry-browser.mjs` runs 16 isolated
production Next.js/PostgreSQL/Chromium cases on localhost:3102 with a synthetic
tenant, no dispatcher, no SMTP and no external relay. Real CI acceptance must be
checked for the exact final head. Static validator changes follow the extracted
hook and explicit limits; authorization/projection and retry assertions remain.
