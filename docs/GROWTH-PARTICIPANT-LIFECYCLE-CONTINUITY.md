# Growth participant lifecycle continuity

Performance and Learning participant work joins the shared Lifecycle Action Center without creating another rating, learning or decision engine.

## Performance participant attention

The Action Center surfaces only identity-bound review work that the signed participant can already perform in the owning Performance domain:

- Self review requires `performance:self-submit`, the signed `employmentId`, an open review cycle and `NOT_STARTED` / `SELF_REVIEW` state.
- Manager review requires `performance:manager-review`, `managerEmploymentId` equal to the signed employment identity, an open review cycle and `MANAGER_REVIEW` state.
- The Action Center does not load `selfRating`, `managerRating`, `finalRating`, calibration notes or review narrative.
- Human-owned ratings remain entered only inside the existing participant Performance console and APIs.

Deep links use `/module/performance?review=<reviewId>`. The participant loader bounds the identifier, then rechecks tenant, employment identity, assigned-manager identity, actionable state and open-cycle state. There is no unscoped primary-key fallback.

## Learning participant attention

Learning attention requires `learning:self-progress` and is limited to assignments for the signed employment identity in `ASSIGNED`, `IN_PROGRESS` or `OVERDUE` state.

Action Center rows contain only course code/title, mandatory/development context, state and due date. Scores, certificate/evidence references, development-plan narrative and proficiency evidence are not projected into the aggregate queue.

Deep links use `/module/learning?assignment=<assignmentId>`. Exact focus is tenant + signed-employment scoped and only participant-actionable assignments can be focused.

Completing learning remains evidence for later human reassessment. It does not automatically change skill proficiency, talent assessment, succession readiness or any other employee decision.

## Mutations and notifications

The Action Center never submits a rating or learning completion itself. It only deep-links to the existing governed APIs:

- Performance self submission remains in `performance/reviews/[id]/self-submit`.
- Manager submission remains in `performance/reviews/[id]/manager-submit`.
- Learning progress remains in `learning/assignments/[id]/self-transition`.

After a successful owning-domain mutation, the participant UI acknowledges matching `PerformanceReview` or `LearningAssignment` notifications on a best-effort basis and emits a lifecycle invalidation event. Notification cleanup cannot roll back a committed rating or learning transition.

## Dashboard and Analytics

Dashboard and Analytics reuse the same continuity source. They receive aggregate `performance` and `learning` counters only. Ratings, employee review detail, course evidence and record identifiers do not cross the Analytics boundary.

Growth aggregation is fail-soft: if Performance or Learning participant aggregation fails, the core governed Action Center remains available rather than retrying through a wider population query.

## Validation contract

The lifecycle validators enforce:

- capability and signed-employment binding,
- assigned-manager binding,
- actionable review/learning states,
- open performance cycles,
- bounded tenant-scoped exact focus,
- no unscoped deep-link fallback,
- no rating or learning-evidence projection into Action Center/Analytics,
- best-effort notification cleanup only after successful mutations, and
- aggregate-only Dashboard/Analytics continuity.
