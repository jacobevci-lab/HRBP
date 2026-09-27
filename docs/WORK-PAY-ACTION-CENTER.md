# Work & Pay lifecycle action continuity

The Lifecycle Action Center now surfaces human-controlled approval and completion work from Time & Attendance, Leave, Compensation and Payroll without creating a second approval engine.

## Source-domain ownership

The Action Center is a read-only attention layer. It does not approve time or leave, apply compensation, approve payroll or mark payroll paid. Every row deep-links back to the existing governed domain control where authorization, state transitions, audit and separation-of-duties rules continue to execute.

The Work & Pay source is bounded to 150 attention rows and contains only the minimum metadata needed to identify the pending control. Salary values, gross/net pay, employer cost, bank data and payroll result detail are not loaded by the Action Center.

## Time & Attendance

Time attention is emitted only when the signed actor has both `time:read` and `time:approve` and the entry is `SUBMITTED`.

The same employment relationship scope used by the operating workspace is reused. The actor's own employment is explicitly removed from the approval population, preserving the self-approval boundary before the user reaches the decision route.

Rows route to `/module/time-attendance?focus=<timeEntryId>`. The focused row is resolved again through tenant + employment scope and can be pinned even when the work date is outside today's standard operating table. Daily metrics remain based on today's normal population and are not distorted by the focused historical row.

## Leave

Leave attention is emitted only for `PENDING` requests when the actor has both `leave:read` and `leave:approve`.

Employment relationship scope and the no-self-approval rule are applied before the row enters the Action Center. The exact target resolves through `/module/leave?focus=<leaveRequestId>`, and an older or future request outside the normal 60-day table is shown only if the same governed scope still permits it.

## Compensation

Compensation attention is intentionally split by authority:

- `APPROVAL` changes require `compensation:approve`.
- `APPROVED` changes require `compensation:apply`.
- the original requester is excluded from both Action Center signals.

Only employee identity, lifecycle state and effective date are projected into the attention layer. Current/proposed salary values and the change reason remain inside the restricted Compensation workspace.

Rows route to `/module/compensation?focus=<compensationChangeId>`. Exact focus resolution reuses the same employment scope as the restricted compensation table.

## Payroll

Payroll attention is limited to actors with `payroll:read` plus the authority required for the current state:

- `APPROVAL` requires `payroll:approve` and excludes the run creator using the immutable `payroll-run.created` audit evidence.
- `APPROVED` requires `payroll:pay` and excludes the actor who approved the same run.

The Action Center shows period/country/run identity only. Gross, net, employer cost and employee payroll results remain inside the restricted Payroll workspace.

Rows route to `/module/payroll?focus=<payrollRunId>` and the exact run is resolved inside the signed tenant before it is pinned.

## Notification continuity

Existing Work & Pay notifications already use resource-specific query parameters (`entry`, `request`, `change`, `run`). Module routing converges those legacy notification links and the new Action Center `focus` link into the same governed focus resolver. This avoids duplicate lookup paths while preserving compatibility with already-delivered notifications.

After a successful Time, Leave, Compensation or Payroll transition, the corresponding in-app notifications are acknowledged by resource id on a best-effort basis. Notification cleanup occurs only after the governed business mutation succeeds and can never roll back a committed domain transition. The notification badge refresh event is emitted only when acknowledgement succeeds.

An inaccessible or stale identifier is never widened into a broader lookup and is not echoed back as a resolved focus.

## Dashboard and Analytics

Dashboard and Analytics receive only the aggregate `workPay` count from the Lifecycle Action Center summary. The common `total`, `critical`, `overdue` and `dueSoon` counters also include Work & Pay attention after it has passed the source-domain authorization rules.

Analytics never receives Work & Pay row data, employee identifiers, salary values or payroll amounts. Failure remains fail-closed: there is no tenant-wide fallback query.

## Validation

The existing lifecycle validators assert that:

- Work & Pay attention reuses employment scope and domain capabilities,
- self approval is excluded for Time and Leave,
- compensation requester separation is preserved,
- payroll creator/approver separation is preserved,
- salary and payroll-result values are absent from the Action Center source,
- exact focus links resolve only through governed tenant/relationship scope,
- successful domain transitions acknowledge resource notifications only as best-effort cleanup,
- Dashboard and Analytics consume aggregate counts only, and
- Work & Pay Action Center filters route back to the governed domain workspaces.

These validators remain part of `prebuild`, so production builds fail if the continuity or privacy boundaries regress.
