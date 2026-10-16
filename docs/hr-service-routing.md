# HR service routing controls

The staff-only Route / assign dialog changes an existing visible request's queue
and assignee through the existing versioned status endpoint, without changing its
status. It requires explicit confirmation, sends the displayed revision, validates
both returned target values and the write receipt, and preserves the mounted
unknown-write guard across close/reopen and revision updates. It never performs
an automatic retry. Reloading choices is a read, not permission to replay a write.
A full-page reload resets local memory; this is not durable command idempotency.

The new read-only routing-options endpoint checks the verified session,
hr-service:read/write, staff role and existing request scope BEFORE reading
candidates. Queue choices are active and delegated (or tenant-wide for queue
administrators). Queue assignees are active same-tenant staff members. For an
unqueued request, HRBP gets a self-only suggestion, not the full staff directory;
queue administrators see active staff. The existing status API remains the
mutation authority; an options response grants no new rights.

Choices are bounded to 100 queues and 200 eligible staff, with explicit truncation
flags and UI warning. No complete directory/search claim is made. Missing current
queue/assignee choices are not silently replaced: the operator must choose again.
Changing queue explicitly clears the proposed assignee. All read responses are
private/no-store, including denials. Context changes/close abort pending reads;
wrong viewer, tenant, request, selected queue or revision is rejected before render.
The dialog shares existing native focus/scroll handling, EN/TR and theme surfaces.

## Routing-only lifecycle correction

The old status handler used the resulting status alone to establish firstResponseAt,
rewrite resolvedAt, clear escalation and acknowledge escalation notices. As a
result a routing-only change on a waiting/resolved request could change lifecycle
evidence even though status did not change. These effects now require an actual
status transition. Closed/cancelled requests cannot be rerouted through this path.
Normal lifecycle transitions retain their existing side effects. Routing advances
the version, writes a routing audit and creates assignment notification intent
when a new assignee is chosen; it creates no status transition or SLA pause record.
No historical values are automatically repaired or rewritten by this release.

No schema, role grants, existing privacy rules or attachments change. Transaction
snapshots do not guarantee instantaneous membership/account revocation after a
read; that broader synchronization concern is not claimed solved here. Separate
same-version commands conflict, not replay as success. A successful response after
an intentional route change may leave the actor without visibility to the moved
request; do not broaden scope to redisplay it.

Unit/component tests execute actual handlers with controlled dependency doubles.
The disposable localhost-only routing browser suite performs real API and UI
writes, checks preserved lifecycle timestamps, queue/assignee restrictions,
unknown transport results, stale versions, contention and four narrow viewports.
Check exact-head CI results before merge/deployment. No production data is used.
