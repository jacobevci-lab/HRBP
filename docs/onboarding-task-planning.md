# Onboarding task planning and missing deadlines

## Supported operations

The authorized onboarding page now offers a task-planning editor. It uses only
plans/tasks in the currently loaded, authorized page or exact notification
focus. It does not broaden population visibility or change the existing page
limits. The unchanged readiness console still owns completion, blockers,
waivers and activation.

`POST /api/onboarding/plans/{id}/tasks` adds one task in `NOT_STARTED` with a
bounded title, responsible team type, explicit sensitivity flag, UTC deadline,
reason and creation request ID. Team type is not a named employee assignment.
The server derives the tenant, actor, record identity and lifecycle status.

`POST /api/onboarding/tasks/{id}/deadline` assigns a deadline only when the
existing task has no deadline and is still open. It cannot replace, postpone
or remove an assigned date, reopen a completed/waived task, or clear a blocker.
Reasons have 10–500 trimmed characters. Past dates are permitted explicitly;
they remain past dates and are eligible for normal overdue monitoring.

The form explains the browser time zone and sends canonical UTC. No employee
is activated and no readiness control is silently waived by either operation.
Both require an open plan linked to the same tenant/person's PREBOARDING
employment. Empty open plans are supported; an empty plan already marked
COMPLETED requires a separate governed correction and is not silently reopened.

## Authority, concurrency and evidence

Both routes recheck the request context, same-origin mutation rule and
onboarding read/write capabilities before reading a bounded 8 KiB JSON body.
Unknown fields are rejected, including client-supplied tenant, actor, status
and named assignee. Canonical UTC dates are validated by round trip; invalid
calendar dates and implicit time zones are rejected.

Each operation resolves the existing onboarding population policy again inside
a bounded Serializable transaction. Tenant, plan, task and employment/person
linkage are checked. Missing and inaccessible records return the same 404.
An expected plan state is required; deadline assignment additionally compares
the expected task state. The update predicate includes task/plan/tenant,
current task status and `dueDate: null`, so another writer's deadline is never
overwritten. Existing activation/status routes are unchanged.

The domain write and classified audit entry commit together. Creation stores
reason, team, date and sensitivity in audit evidence; deadline assignment stores
reason plus the null-to-date change. Titles, health, salary or identity details
should not be placed in the reason. Existing readiness reminder processing
picks up newly scheduled tasks under its normal rules; this slice does not add
an immediate assignment notification or alter reminder deduplication.

Creation uses a deterministic task ID derived from tenant, actor, plan and a
client-generated UUIDv4 request ID. Replaying that request ID returns a conflict,
not a second task and not an assertion that a changed payload was reapplied.
Different explicit request IDs can create separate tasks with the same title.
This is duplicate protection, not an exactly-once network protocol.

UI writes are not automatically retried. Ambiguous/failing responses lock the
editor until the current page is reloaded for verification. During submission,
page navigation and readiness controls are disabled. Successful writes reload
the existing page/focus rather than inserting an unverified optimistic record.
An HTTP/client timeout does not guarantee that server work was cancelled.

## Verification

`node --test scripts/onboarding-task-planning.test.mjs` executes 68 cases against
the actual TypeScript helper and route wrappers with isolated mocked identity,
scope and transaction dependencies. These cover validation, tenant/scope checks,
closed records, expected-state conflicts, duplicate IDs, controlled database
conflicts, audit rollback and UI wiring.

`scripts/onboarding-task-planning.postgres.test.mjs` runs in CI only when its
DATABASE_URL is provided. It refuses non-loopback hosts and any database name
other than the disposable CI `hrbp` database. It exercises real Prisma/PostgreSQL
transactions and the actual audit writer with synthetic authentication/scope:
creation, concurrent duplicate writes, concurrent deadline assignment, rollback,
terminal records and isolation predicates. Cleanup is limited to its randomly
named fixture tenant. Locally, without a database, this suite is skipped—not
claimed passed. Both files are included in the existing onboarding observability
prebuild gate alongside the readiness and pagination regression suites.

These tests do not establish real-browser layout/accessibility, production load
capacity or successful Worker rollout. This feature makes no schema, dependency,
AI, deployment-configuration or billing changes. Full rescheduling with preserved
SLA history, template authoring and named task assignment remain separate work.
