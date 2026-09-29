# Benefits Action Center continuity

## Scope

This increment connects only genuinely pending Benefits governance work to the shared Lifecycle Action Center. It does not create employee self-service where none exists and it does not automate enrollment, waiver, activation or coverage decisions.

## Governed attention

A Benefit Enrollment enters the shared queue only when:

- the signed actor has `benefits:write`;
- the enrollment belongs to the actor's existing employment relationship scope;
- the enrollment status is `PENDING`.

The election effective date is used as the operational due date. A pending election whose effective date has passed becomes critical attention, while an election due within 24 hours becomes warning attention. The shared queue remains bounded.

The Action Center receives only the identifiers and context needed to route the human operator: enrollment ID, employee display name, plan code/name, pending status, effective date and creation timestamp. Coverage tier and employer/employee contribution amounts remain in the owning Benefits workspace.

## Exact focus

Action Center entries deep-link to `/module/benefits?enrollment=<id>`. The Benefits workspace bounds the supplied identifier and reuses the same tenant + employment relationship visibility predicate for the focused lookup. It never falls back to an unscoped primary-key lookup. An authorized focused row is pinned/highlighted; an out-of-scope or no-longer-actionable record yields a fail-closed warning.

## Human decision boundary

The Action Center never activates, waives or ends benefit coverage directly. Those decisions remain in the existing governed Benefits transition endpoint, protected by `benefits:write`, relationship scope, state-aware transitions and audit evidence. After a successful owning-domain mutation, the UI signals the shared Action Center to refresh.

## Dashboard and Analytics

Dashboard and Analytics receive only the aggregate `benefits` counter through the existing continuity summary. Coverage tier, contribution amounts and enrollment row details never cross that boundary.

## Validation

`npm run benefits-action-center:validate` verifies capability gating, relationship scope, pending-only state, bounded aggregation, minimized shared payload, exact-focus scoping, deep-link-only behavior, lifecycle refresh and aggregate-only Dashboard/Analytics projection. It is wired into `prebuild`; GitHub CI remains authoritative for typecheck, Next.js production build, Cloudflare build and smoke tests.
