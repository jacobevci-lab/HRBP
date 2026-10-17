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


## Preparing a subsequent routing change after a confirmed save

A mounted routing form previously stayed locked after a validated successful
save, even after its choices were read again. It now offers an explicit
**Prepare new routing / Yeni yönlendirme hazırla** control. No POST is sent by
that control. It clears only the existing helper's confirmed-save guard and
starts from the freshly read current queue and assignee.

The control requires a new initial options read authorized for the same actor,
tenant, role and request. Its revision, status, queue and assignee must exactly
match the previously validated write receipt and the displayed request revision.
A receipt alone, old options, failed reauthorization, substituted targets or a
newer independent change cannot rearm the form. A captured old prepare callback
also cannot bypass a changed principal/revision or an outstanding/failed reread.
For a newer independent change use full current-record review, not this shortcut.

Only one small in-memory confirmed binding is retained (context key, revision,
status and routing identifiers), not employee names or response bodies. Unknown,
denied and conflict outcomes never acquire this binding and remain blocked across
close/reopen or option reload. Preparing is not an idempotency retry, and no
backend permission or write-revision rule changed. Another intentional command
still uses its reviewed revision and normal server-side concurrency control.

The added recovery unit tests use handler/component doubles. Five additional
real API/Chromium scenarios cover two deliberate routing changes without a full
navigation in EN/TR, a denied options read, substituted same-revision targets,
and an independently changed newer revision. Exact-head CI results are required
before this continuation is considered integration-tested.
