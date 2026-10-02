# Day-one readiness: paged operations and notification focus

## Readiness and unchanged mutation boundaries

Plans are independent of task rows, so empty plans remain visible. Ready-now
requires a completed plan, linked PREBOARDING employment, a nonempty complete
task list with every task completed or explicitly waived, and both planned and
employment start dates reached. Waiting-for-start is separate from ready-now.
Incomplete, inconsistent and unknown inputs remain review signals, not repairs.
Waived work is counted separately from completed work; missing deadlines are
not inferred. The risk horizon uses HRBP_ONBOARDING_START_RISK_HOURS (1–336,
default 72). The existing readiness projection and action console are unchanged
and now live behind a page browser; the console file was moved without content
changes to components/onboarding-readiness-console.tsx.

Every mutation still uses its original API with origin, capability, population,
state, date and audit controls. An exact-focus read never grants mutation rights.
No schema, dependency, AI or deployment configuration changes are required.

## Read API

GET /api/onboarding/operations requires onboarding:read AND onboarding:write.
Authentication is resolved before query parsing, and data access independently
rechecks the capabilities. All responses, including errors, are no-store.

- No query: first active, authorized page.
- after: a bounded JSON positional cursor [1, UTC-start-date, plan-id].
- plan and/or task: exact focus; supplied identifiers must agree on one plan.

Unknown/duplicate/empty parameters and mixed paging/focus are rejected with
400 before opening the database. Missing, inactive and out-of-scope focus targets
produce the same 404 response, with no substitute or broader lookup. Errors do
not echo selectors, SQL, employee data or credentials.

Each request intersects tenant, active-queue eligibility, current relationship
scope and the positional/focus predicate using AND. Read scope, plan rows,
nested task totals and any pinned task are read in one bounded RepeatableRead
transaction. This is a coherent per-request read, NOT a snapshot held across
multiple pages and NOT a distributed lock against later mutations.

## Pagination and task limits

Plan ordering is targetStartDate ascending, then unique id ascending. The cursor
compares values rather than requiring the anchor row to still exist. It is not
an authorization token: altered cursors still cannot bypass scope predicates.
At most 100 plan rows are returned, with an extra sentinel determining whether
another page exists. Each plan still exposes at most 200 tasks and an independent
total. No unbounded client-side accumulation or database count of the whole
organization is introduced.

Next/previous navigation reloads the selected page. Previous-page cursors remain
only in component memory, not browser storage. Concurrent changes to start dates,
queue eligibility or scope may shift rows between pages. Restart the queue for a
fresh traversal; stable ordering is not a promise of historical snapshot paging.
Counts, risk ordering, search and team/readiness filters are page-local. The UI
explicitly discloses this; an empty filtered page is not an empty organization.
Filters retain whole plans and all loaded tasks. Twenty-plan increments inside a
page are rendering controls, while Next page fetches a new server page.

## Notification focus

The browser follows plan/task parameters on navigation, including repeated
parameters for validation. It does not assume a missing target has been deleted.
An authorized target beyond the first 100 plans is loaded directly. If a target
task is outside the first 200 tasks of its plan, it replaces one displayed task
inside the same cap. The independent total remains unchanged: the incomplete
plan warning and withheld activation are preserved. This is NOT full task-list
pagination; tasks without a direct focus link beyond the cap need follow-up work.
Return to plan queue clears focus without weakening access checks.

## Client refresh safety

Read requests use same-origin credentials, no-store, redirect rejection, a
20-second timeout and AbortController cleanup. The client validates the page
protocol and prevents a stale response from replacing a newer selection. Old
records/action controls are hidden during read failures and changes of query or
server snapshot. It does not automatically retry. Existing write actions retain
their synchronous in-flight guard, reason capture and confirmation. Navigating
away does not cancel a write that the user already initiated.

The browser owns pagination disclosures and suppresses only the old console's
first-snapshot overflow notice. Task incompleteness and every readiness warning
remain visible. A mutation-triggered router refresh causes the current page or
focus to reload instead of silently returning the user to the first page.

## Verification limits

The existing 45 readiness tests remain under onboarding-observability:validate.
Forty new tests exercise the actual TypeScript data adapter and GET handler with
mocked identity/database dependencies, plus cursor parsing, 205-plan traversal,
exact focus, scope intersection, task pinning, safe errors and client wiring.
These are not real-browser, production load, real PostgreSQL pagination or
concurrent authorization-revocation tests. Full application typecheck, build,
existing regression validators and Worker/PostgreSQL maintenance smoke run in CI.
Successful CI and merge do not establish that the live Worker has been deployed.
