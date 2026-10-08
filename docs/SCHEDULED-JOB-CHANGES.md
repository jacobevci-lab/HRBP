# Scheduled employee job changes

## Purpose

Future-dated employee transfers and promotions are persisted as governed schedule records instead of being applied early or delegated to an unaudited calendar/process outside HRBP.

The scheduling flow extends the signed impact-review boundary used for immediate job changes:

1. an authorized operator selects transfer/promotion, target position, effective date and business reason;
2. HRBP generates the normal short-lived signed impact preview;
3. for a future date, confirmation creates a durable `ScheduledPositionChange` rather than mutating employment;
4. operational maintenance revalidates the reviewed state after the effective date arrives;
5. only an unchanged, still-vacant target is applied automatically.

## Scheduling boundary

A schedule can be created only when the effective date is more than one day in the future and no more than 365 days ahead. Creation requires:

- `people:write` and `positions:write`,
- the normal employment relationship/ABAC scope,
- a valid ten-minute signed impact-preview receipt,
- matching actor, tenant, person, employment, source/target position, event type, effective date and reason,
- unchanged impact digest,
- an OPEN and unoccupied target position,
- no existing PENDING schedule reserving either the same employment or target position.

The schedule stores the reviewed impact digest but never the preview token or session credential.

## Effective-date execution

Due records are processed from the existing authenticated operational-maintenance domain in a bounded batch. The default batch is 100 and the supported deployment range is 10–250 through `HRBP_SCHEDULED_JOB_CHANGE_BATCH_SIZE`.

Execution rechecks:

- the exact employment is still active and still on the reviewed source position,
- the target still exists, is current and OPEN,
- another active incumbent did not take the target,
- source/target organization, grade, location and criticality,
- manager relationship and direct-report count,
- open recruiting demand on the target position.

If reviewed impact changed, the schedule becomes `BLOCKED`; it is never silently rewritten or blindly retried as a different decision. Blocked status uses bounded diagnostic codes such as `IMPACT_STATE_CHANGED`, `SOURCE_POSITION_CHANGED`, `TARGET_POSITION_OCCUPIED` and `TARGET_STATE_CONFLICT`.

A successful run updates employment, source/target position status, employee lifecycle evidence, scheduled-change state and append-only audit evidence transactionally. The original requester receives an in-app outcome notification.

## Cancellation

Only a `PENDING` schedule can be cancelled. Cancellation requires the same tenant, employment scope and write authority as scheduling, records the cancelling actor/time and writes audit evidence. `APPLIED`, `BLOCKED` and already `CANCELLED` records are immutable terminal outcomes.

## Operations

The private operational metrics endpoint exposes aggregate-only schedule posture:

- `hrbp_scheduled_position_changes{status="..."}`
- `hrbp_scheduled_position_changes_due`
- `hrbp_scheduled_position_changes_oldest_due_age_seconds`

No employee, tenant, position, schedule or requester identifiers are emitted as metric labels or values.

## Failure model

Automatic application is fail-closed. Reviewed-state drift, vacancy loss or concurrent state changes block the schedule and require human review. Maintenance does not repeatedly replay a blocked business decision.

The maintenance runner itself retains its existing no-blind-retry/ambiguous-outcome safety boundary. Backup/restore captures the database schedule state with the rest of the governed HR data.
