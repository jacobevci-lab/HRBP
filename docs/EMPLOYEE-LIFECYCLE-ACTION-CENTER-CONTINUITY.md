# Employee lifecycle Action Center continuity

## Scope

This increment connects onboarding execution and offboarding clearance to the shared Lifecycle Action Center without creating a second decision engine. The owning domain APIs remain the only mutation surfaces.

## Onboarding attention

Onboarding enters the shared queue only when the signed actor has `onboarding:write`. Population scope is resolved through the existing onboarding relationship policy (`resolveOnboardingPopulationScope` + `onboardingPlanPopulationFilter`).

Only open, non-sensitive onboarding tasks are projected. Sensitive onboarding tasks never enter the shared queue. The projection contains only the task identifier, employee display name, task title/owner type, state and operational due date. The existing onboarding workspace remains responsible for state transitions, blocker/waiver reasons, audit evidence and employment activation.

Rows deep-link to the existing scoped task focus (`/module/onboarding?task=<id>`). That workspace only highlights records already present in its relationship-scoped operational dataset; it does not perform a broader primary-key fallback.

## Offboarding attention

Offboarding enters the shared queue only when the signed actor has `offboarding:write`. Open separation processes remain tenant + employment-relationship scoped.

The shared queue deliberately uses process-level attention instead of projecting restricted exit detail. It reads only the separation state, last working date, final-settlement state and bounded counts of still-open blocking tasks, assets, access revocations and knowledge-transfer controls. It does not load employee exit narratives, rehire or replacement decision reasons, final-settlement notes, account identifiers, asset serial numbers, condition notes or access exception narratives.

The Action Center never closes an employment, revokes access, writes off an asset, decides replacement need or performs final settlement. Those human-controlled actions stay in the existing Offboarding domain controls.

## Shared queue and analytics

Onboarding and Offboarding are independent source filters in the Lifecycle Action Center. The combined queue remains bounded to 300 rows and retains critical/due-soon/overdue ordering.

Dashboard and Analytics receive aggregate `onboarding` and `offboarding` counters only. Record-level titles, employee names, task data and clearance detail do not cross the aggregate analytics boundary.

## Failure behavior

The new employee-lifecycle aggregation is fail-soft. A failure while gathering Onboarding or Offboarding attention sets `employeeLifecycleDegraded` and preserves the already-governed core and growth Action Center instead of retrying through a broader tenant query.

## Validation

`npm run employee-lifecycle-action-center:validate` enforces capability gating, relationship scope, sensitive-task exclusion, bounded queries, minimized offboarding projection, deep-link-only mutation ownership, Action Center filters and aggregate-only Dashboard/Analytics continuity. GitHub CI remains authoritative for Prisma validation, typecheck, production build, Cloudflare build and smoke tests.
