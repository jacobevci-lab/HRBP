# Growth owner action continuity

## Scope

This increment connects human-owned Development Plan and Succession review attention to the shared Lifecycle Action Center. It does not introduce an automated talent decision engine and it does not change proficiency, potential, critical-talent or successor-readiness values.

## Development Plan attention

Only signed actors with `talent:write` receive Development Plan owner actions. Records are tenant-scoped, explicitly bound to `ownerId = ctx.actorId`, limited to `ACTIVE` plans and limited to the configured `HRBP_DEVELOPMENT_PLAN_WARNING_DAYS` horizon. The Action Center receives only plan ID, title, lifecycle status, target date and update timestamp. Outcome notes, talent ratings, learning score/certificate evidence and proficiency evidence stay in the owning domain.

The action deep-links to `/module/talent?developmentPlan=<id>`. Module routing keeps this focus separate from Performance and Learning focus identifiers; normal Talent authorization remains authoritative.

## Succession review attention

Only signed actors with `succession:write` receive Succession Plan review actions. Records are tenant-scoped, explicitly bound to `ownerId = ctx.actorId`, must be active and must have a review date inside the configured `HRBP_SUCCESSION_REVIEW_WARNING_DAYS` horizon. Position code/title may be used only to make the queue item understandable. Candidate readiness, rank, development gap, talent assessment detail and linked learning evidence are not loaded into the shared queue.

The action deep-links to `/module/succession?plan=<id>`. Updating readiness remains an explicit human action inside Succession governance; reaching a due date or completing learning never changes readiness automatically.

## Shared queue behavior

The continuity wrapper continues to extend the governed core Action Center instead of replacing it. Growth source failure is fail-soft: the core queue remains available, and there is no broader fallback query. The combined queue remains bounded to 300 items and is sorted by urgency, then due date, then creation/update time.

Dashboard and Analytics receive aggregate counts only (`developmentPlans`, `succession`). They do not receive row-level plan/candidate data or decision evidence.

## Validation

`npm run growth-owner-attention:validate` checks owner binding, capabilities, active/actionable state, reminder horizons, exact deep-link vocabulary, bounded aggregation, data minimization, Action Center filters and aggregate-only Dashboard/Analytics projection. The validator is part of `prebuild`; GitHub CI remains authoritative for typecheck, Next.js production build, Cloudflare build and smoke tests.
