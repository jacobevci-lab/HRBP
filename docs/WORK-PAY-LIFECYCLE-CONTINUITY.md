# Work-pay lifecycle continuity

Leave and Time & Attendance approvals participate in the shared Lifecycle Action Center without creating a second approval engine.

## Approval attention

The Action Center surfaces only records that the signed actor can actually approve:

- Leave requires `leave:approve` and `LeaveRequestStatus.PENDING`.
- Time & Attendance requires `time:approve` and `TimeEntryStatus.SUBMITTED`.
- Both domains reuse `resolveEmploymentScope` / `employmentIdFilter`.
- The actor's own employment record is excluded from approval attention, preserving the existing no-self-approval rule.
- Source queries are bounded and tenant scoped.

The Action Center never performs leave or time decisions directly. It deep-links to the existing governed domain controls:

- `/module/leave?request=<leaveRequestId>`
- `/module/time-attendance?entry=<timeEntryId>`

This keeps policy checks, balance reservation, state transitions, audit evidence and separation-of-duties enforcement inside the owning domain.

## Exact focus without scope widening

The work-pay live-data layer accepts an optional exact focus identifier. An exact lookup always includes both `tenantId` and the same `employmentIdFilter(scope)` used by the operating view.

There is no unscoped primary-key fallback. A stale or inaccessible deep link therefore renders the normal authorized workspace with a restricted/not-available message instead of confirming hidden record details.

The normal operating metrics are still calculated from their original bounded horizons. An older exact-focus record can be pinned into the visible table without changing today's time metrics or the 60-day leave metrics.

## Notifications

Notification routing already uses the same domain deep links for `LeaveRequest` and `TimeEntry` resources. After a successful approval/rejection mutation, the client performs best-effort notification acknowledgement for the matching resource.

Notification cleanup is deliberately secondary to the business mutation: if badge acknowledgement fails, the accepted leave/time decision is not rolled back.

## Privacy and data minimization

Action-center rows contain only the minimum operational context needed to recognize the approval: employee display name, leave type/units or time duration/overtime, status and governing dates. Leave comments, medical/supporting evidence, payroll results and unrelated employee details are not loaded into the aggregate queue.

Dashboard and Analytics continue to consume the shared aggregate summary rather than record-level leave/time rows.

## Validation

`npm run lifecycle-action-center:validate` verifies that:

- approval capabilities are mandatory,
- employment relationship scope is reused,
- self-approval records are excluded,
- only Pending leave and Submitted time records enter the approval queue,
- deep links terminate in governed work-pay workspaces,
- exact focus remains tenant + employment scoped,
- no unscoped exact-record fallback exists, and
- notification acknowledgement occurs only after successful domain mutation.
