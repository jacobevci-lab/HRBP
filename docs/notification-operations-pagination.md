# Notification operations paging

The settings queue console can now read beyond the first 100 items via **Older
records / Daha eski kayıtlar**. **First page** and **Refresh** return to the latest
page; changing status or principal starts a newly scoped reading. Counters remain
tenant totals and each displayed page replaces the preceding rows.

GET `/api/settings/notifications/operations` remains compatible with callers that
omit `after`: the original bounded response and limit remain unchanged. Supplying
`after=` opts into the first paged read. A nonempty `after` is an opaque tuple of
version, actor, tenant, role, filter, limit and the last displayed ordering key
(updatedAt DESC, createdAt DESC, id ASC). The tuple is validated before querying;
every request also performs normal session and capability authorization. It is
not a secret, signature, permission grant or durable transaction identifier.

Paged reads fetch at most limit+1 (101) rows, project at most limit (100), and
return `page: {after, next}`; null next means no later row in that read. Counts
and items share the existing RepeatableRead transaction. Filters and tenant
conditions apply to every page, and no offset/unbounded directory is used. The
anchor is a tuple rather than a row lookup, so anchor deletion or movement does
not make subsequent rows inaccessible. Payload, recipient, dedupe and raw error
fields remain excluded/redacted; retry writes and permissions are unchanged.

The browser checks the returned requested cursor, viewer, scope and next-boundary
identity. A failed or substituted read hides prior rows and disables pagination.
Changing pages aborts an old read and invalidates captured retry applicability;
retry outcome guards remain mounted across pages. Preparing a page never POSTs.

This is a live queue, not a cross-request historical snapshot. Concurrent updates
can move records between pages; Refresh starts a new latest reading. Page numbers
are navigation position, not immutable record ranges. No complete export, delivery
confirmation, durable command deduplication or delivery reconciliation is added.
There is no previous-page cache or automatic prefetch; First page is the return
control. Existing batch preview remains capped at its explicitly reviewed 100.

Verification: `scripts/notification-pagination.test.mjs` executes the real handler,
contracts and read hooks with controlled dependencies. The separate browser suite
runs 12 scenarios using production Next.js, signed synthetic sessions and disposable
PostgreSQL with the existing guarded .dev.vars test lease; it starts no dispatcher
or SMTP relay and never changes production configuration. Results must be checked
against the exact final head. Existing test assertions remain; static bounds checks
are updated to require capped lookahead plus response slicing.
