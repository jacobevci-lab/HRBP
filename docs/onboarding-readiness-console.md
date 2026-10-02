# Day-one readiness: operational view

The onboarding write console now consumes a plan-aware, authorized snapshot.
Plan identity is independent of task rows: empty plans remain visible and are
not treated as verified ready. The existing `tasks` component prop carries the
snapshot so its server workspace call remains unchanged.

## Meaning of the view

* **Ready now** requires a completed plan, a linked PREBOARDING employment, at
  least one task, a complete task list, every task completed or explicitly waived,
  and both the planned start and employment start dates reached.
* **Waiting for start date** has cleared tasks but at least one of those dates
  is still in the future. It is not included in the ready-now count.
* **Start-date risk** uses HRBP_ONBOARDING_START_RISK_HOURS, clamped to 1–336
  hours with the same default of 72 as maintenance. Past-start open plans also
  remain at risk. This is operational timing, not employee scoring.
* Completed and waived tasks are separate counts. Waiver clearance does not
  assert that the task was performed. Missing deadlines are explicitly unset;
  the interface no longer implies that an unseen policy supplies a deadline.
* Empty plans, missing employment/dates, unknown or inconsistent states and
  incomplete task lists are review signals, not automatic database repairs.

The read model in `lib/onboarding-readiness-view.mjs` is pure and does not fetch
records, grant permissions, transition employment or issue notifications.
The server query retains tenant and onboarding population scope and explicitly
requires onboarding read/write authority. Activation visibility additionally
requires people write authority. The existing mutation endpoints still enforce
origin, capabilities, relationship scope, task/state rechecks and audit writes.
No mutation endpoint or database schema is changed in this feature.

## Filters and limits

Search (employee name, number or task title), responsible **team type** and
readiness filters select whole plans. Selecting IT never hides a security
blocker elsewhere in the same plan and never changes completion denominators.
Team type is not a claim that a named person has been assigned. Search is
client-side within the authorized snapshot; it is not sent to a new endpoint,
persisted in browser storage or used to broaden population visibility.

The query loads at most 100 plans (one extra record detects more results) and
200 tasks per plan. The task total is independently selected with `_count`.
Any incomplete plan is visibly flagged and has no activation action. Counts
and filters describe the loaded snapshot, not organization-wide totals.
Rendering initially displays 20 matching plans with a show-more control.
This is not server-side pagination: accessing plans beyond the 100-plan limit
or additional tasks beyond the per-plan limit remains a follow-up capability.

Notification links highlight only already-loaded records. A loaded target
hidden by filters is distinguished from a target not found in the snapshot.
An unresolved target is not declared deleted/inactive and triggers no broader
lookup. The initial clock comes from the server snapshot and advances with
monotonic elapsed browser time; refresh retrieves new source data. This is not
a real-time subscription.

## Interaction safety and verification

Existing reason-required block/waive transitions are retained with the
500-character input limit. Identifier path segments are encoded. Activation
requires an explicit user confirmation, plus the unchanged server checks.
A synchronous in-flight guard prevents duplicate clicks and controls remain
disabled during a pending mutation/refresh. Failed requests are not retried.

`node --test scripts/onboarding-readiness-view.test.mjs` covers 45 deterministic
cases: date boundaries, incomplete/empty/duplicate inputs, distinct waiver
counts, scoped joins, Turkish search, whole-plan filtering and risk ordering.
`npm run onboarding-observability:validate` runs those tests and source-wiring
checks through the existing prebuild gate. The readiness governance validator
retains its server-side security/audit/transition checks and now checks the new
UI wiring rather than removed implementation-local variables.

These unit and wiring checks do not establish visual browser correctness,
production load capacity or successful live deployment. The full application
TypeScript/build/Worker suite must pass separately before merging.
