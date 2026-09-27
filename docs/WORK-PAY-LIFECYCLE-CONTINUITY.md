# Work-pay lifecycle continuity

Leave, Time & Attendance, Compensation and Payroll controls participate in the shared Lifecycle Action Center without creating a second approval engine.

## Governed attention

The Action Center surfaces only records that the signed actor can actually act on:

- Leave requires `leave:approve` and `LeaveRequestStatus.PENDING`.
- Time & Attendance requires `time:approve` and `TimeEntryStatus.SUBMITTED`.
- Leave and Time reuse `resolveEmploymentScope` / `employmentIdFilter`, and the actor's own employment is excluded from approval attention.
- Compensation requires `compensation:read` plus `compensation:approve` and/or `compensation:apply`. Approval attention is limited to `CompensationChangeStatus.APPROVAL`; apply attention is limited to `APPROVED`. The requester is excluded from both paths.
- Payroll requires `payroll:read` plus `payroll:approve` and/or `payroll:pay`. Approval attention is limited to `PayrollRunStatus.APPROVAL`; payment attention is limited to `APPROVED`.
- Payroll approval resolves the immutable `payroll-run.created` audit evidence and excludes the run creator. Payment attention excludes the actor who approved the same run.
- All source queries are bounded and tenant scoped.

The Action Center never performs these financial or employment decisions directly. It deep-links to the existing governed domain controls:

- `/module/leave?request=<leaveRequestId>`
- `/module/time-attendance?entry=<timeEntryId>`
- `/module/compensation?change=<compensationChangeId>`
- `/module/payroll?run=<payrollRunId>`

This keeps policy checks, balance reservation, salary baseline revalidation, payroll input fingerprinting, state transitions, audit evidence and separation-of-duties enforcement inside the owning domain.

## Exact focus without scope widening

Work-pay live-data accepts an optional exact focus identifier.

- Leave, Time and Compensation exact lookups include `tenantId` and the same employment scope as the operating view.
- Payroll exact lookup remains restricted to the signed tenant and is reached only through the protected `payroll:read` workspace.
- No domain uses an unscoped primary-key fallback for an external deep link.

A stale or inaccessible deep link therefore renders the normal authorized workspace with a restricted/not-available message instead of confirming hidden record details.

Normal operating metrics remain based on their original bounded sets. An exact focused row can be pinned into a table without changing today's Time metrics, the Leave operating horizon, Compensation queue metrics or the recent Payroll-run metrics.

## Separation of duties

The aggregate layer mirrors the owning domain's existing controls; it does not invent weaker alternatives:

- Leave and Time preserve no-self-approval.
- Compensation requester cannot approve, reject or apply the same change.
- Payroll run creator cannot approve the run.
- Payroll approver cannot mark that run paid.
- Compensation application remains baseline-revalidated and effective-dated.
- Payroll calculation, approval and payment remain protected by the locked-input fingerprint and period state machine.

## Notifications

Notification routing uses the same governed deep links for `LeaveRequest`, `TimeEntry`, `CompensationChange` and `PayrollRun` resources.

After a successful business mutation, the client performs best-effort acknowledgement for the matching notification resource. Compensation acknowledgement follows successful approval/rejection/application. Payroll acknowledgement follows successful approval or payment completion.

Notification cleanup is deliberately secondary to the business mutation: if badge acknowledgement fails, the already committed domain decision is never rolled back.

## Privacy and data minimization

Action-center rows contain only the minimum operational context required to recognize work:

- Leave: employee display name, leave type/units, status and governing dates.
- Time: employee display name, duration/overtime, status and work date.
- Compensation: employee display name, state and effective date only.
- Payroll: country, period code, run number, state and pay date only.

The aggregate queue does **not** load compensation amounts, salary baselines, reasons, payroll gross/net/employer-cost results, leave evidence, private notes or unrelated employee details.

Dashboard and Analytics consume the shared aggregate summary only; they do not receive restricted work-pay rows.

## Validation

`npm run lifecycle-action-center:validate` verifies that:

- required capabilities are mandatory,
- relationship scope is reused where applicable,
- self/four-eyes/separation-of-duties exclusions are preserved,
- only actionable domain states enter the queue,
- compensation amounts and payroll results cannot enter the aggregate query,
- deep links terminate in governed work-pay workspaces,
- exact focus remains inside its domain authorization boundary,
- no unscoped exact-record fallback exists, and
- notification acknowledgement occurs only after successful domain mutation.

`npm run lifecycle-analytics:validate` verifies that Compensation and Payroll cross the analytics boundary only as aggregate counters sourced from the same governed Action Center.
