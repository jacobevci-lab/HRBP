# Governed Analytics Privacy Contract

HRBP One analytics must preserve the same workforce authorization boundary used by operational modules. A user who can access only a relationship-scoped population must never receive a tenant-wide aggregate as a substitute.

## Authorization before aggregation

Analytics reads begin with the signed request context and `analytics:read`. The platform resolves the caller's workforce population through the shared employment scope engine. Tenant-wide operational roles may resolve to the tenant population; Manager and HRBP access remains relationship / organizational scope aware.

The authorized population is treated as part of the metric security context, not merely as a UI filter.

## Population-bound snapshots

`MetricSnapshot` records declare one of two population scopes:

- `TENANT`: generated for the governed tenant population.
- `EMPLOYMENT_SET`: generated for an explicit authorized employment set.

Scoped snapshots carry `scopeFingerprint`, a SHA-256 fingerprint over the canonical sorted employment IDs and tenant ID. The fingerprint does not expose the employment IDs, but allows the read path to require an exact population match.

A Manager or HRBP never receives a `TENANT` snapshot when their current authorization resolves to `EMPLOYMENT_SET`. If an exact scoped materialization is missing, the platform returns `SCOPED_RECOMPUTE_REQUIRED` and no value.

## Small-number suppression

Each `MetricDefinition` owns `minPopulation`. Suppression is enforced twice:

1. Materialization time: a generated snapshot is marked suppressed when the metric population is below the definition threshold.
2. Read time: the API re-evaluates `population < minPopulation` even when the stored `suppressed` flag is false.

Suppressed results redact the value, dimensions and exact population from the response. This prevents a stale or incorrectly generated flag from bypassing the metric contract.

## Materialization contract

Analytics workers and governed ETL code should use `materializeGovernedMetricSnapshot()` from `lib/analytics-materialization.ts` rather than writing `MetricSnapshot` directly.

For `EMPLOYMENT_SET` materialization the caller supplies the complete authorization employment set. The platform validates that every ID is an active/non-terminated employment in the same tenant, generates the canonical scope fingerprint, ensures the metric population does not exceed that scope, and applies the definition's suppression threshold.

A metric-specific calculation may use fewer eligible records than the authorization set. `population` is the metric denominator/sample count; `scopeFingerprint` represents the complete authorization boundary used to generate the result.

Each metric/scope combination retains the most recent 24 snapshots. Older derived snapshots are pruned during materialization so repeated refresh operations cannot grow the cache indefinitely.

## Built-in governed metric engine

`lib/analytics-builtins.ts` computes the first system-of-record metrics directly from governed HR records:

- `WORKFORCE_HEADCOUNT`: current non-terminated employments in the authorized population.
- `LEAVE_INCIDENCE_30D`: percentage of the authorized population with approved or taken leave overlapping the last 30 days.
- `TIME_APPROVAL_RATE_30D`: approved/locked entries divided by submitted/approved/rejected/locked time entries in the last 30 days. The privacy population is the distinct employment contributor set, while the fingerprint remains the complete authorization set.
- `GOAL_COVERAGE_YTD`: percentage of the authorized population with a non-cancelled goal intersecting the current year.
- `PERFORMANCE_REVIEW_COVERAGE`: coverage for the latest started review cycle. No snapshot is generated when no review cycle exists; absence of a cycle is not misrepresented as 0% performance coverage.

These calculations deliberately avoid speculative formulas. Metrics such as voluntary attrition and time-to-hire remain externally sourced or future governed calculations until their denominator, historical population and event definitions are explicit.

`POST /api/analytics/materialize` is a same-origin, authenticated derived-data refresh. A caller with `analytics:read` can materialize only the population resolved from their signed request context; the endpoint does not accept a tenant, employment set or fingerprint from the browser. Every refresh is recorded in the audit ledger.

## Lifecycle continuity analytics

The Analytics workspace also exposes an **operational lifecycle continuity** section. This is intentionally separate from population-bound `MetricSnapshot` analytics because it answers a different question: what governed work currently needs the signed actor's attention?

`lib/lifecycle-analytics-continuity.ts` reuses `getLifecycleActionCenterData(ctx)` rather than querying Workflow, HR Service or Employee Relations tables directly. This preserves the exact Action Center visibility contract, including HR Service queue/self-service rules and Employee Relations Case Wall ownership/assignment rules.

Only aggregate counters cross the analytics boundary:

- total actor-scoped attention,
- critical work,
- overdue and due-soon work,
- Workflow task count,
- HR Service attention count,
- Employee Relations attention count.

Analytics never receives the source Action Center rows. Request titles/subjects, comments, private notes, case numbers, case narratives, appeal details, action descriptions, document names and source record identifiers are not projected into the analytics continuity result.

This continuity projection is fail-closed. If the governed Action Center source cannot be resolved, Analytics returns zero counters with `degraded: true`; it does not retry with a tenant-wide or otherwise broader query. The UI explicitly surfaces the degraded state.

Links from the continuity section route back to the existing governed Action Center filters (`critical`, `hr-service`, `employee-relations`). Analytics does not create a second mutation or case-management surface.

## Fail-closed states

The live Analytics workspace can expose these states without exposing protected values:

- `VISIBLE`: exact scope match and threshold passed.
- `MIN_POPULATION`: result is below the governed minimum cohort size.
- `SOURCE_SUPPRESSED`: upstream calculation explicitly suppressed the result.
- `SCOPED_RECOMPUTE_REQUIRED`: the caller is relationship-scoped and no exact population-bound materialization exists.
- `NO_SNAPSHOT`: no eligible materialization exists for a tenant-wide caller, or a metric has no valid source period (for example no started review cycle).

There is no automatic fallback from a scoped result to a tenant-wide value.

## UI and API behavior

Authenticated `/module/analytics` uses the governed live analytics path. The UI reports the caller's authorized population, visible metric count and privacy-held count. Protected values render as unavailable rather than revealing tenant values or small cohort sizes.

The live workspace includes **Refresh governed metrics**. It calls the scoped materialization endpoint and refreshes the server-rendered metric catalog after the governed snapshots are written.

`GET /api/analytics/metrics` uses the same server-side privacy loader, so API and UI distribution rules cannot drift.

## Jurisdiction integrity used by scoped analytics

Country-based HRBP access is backed by effective-dated `EmploymentJurisdiction` records. Jurisdiction administration and country access rules use the shared ISO 3166-1 alpha-2 catalog in `lib/countries.ts`; arbitrary two-letter strings are rejected by the API. This keeps country-derived employment populations deterministic before analytics fingerprinting.

## Staging and schema synchronization

The staging seed creates existing metric snapshots as `TENANT` snapshots through the Prisma default. The population scope fields require the Staging DB Sync workflow to run after schema changes so `prisma db push` updates the staging schema. Scoped materializations are generated by the governed analytics endpoint/engine and must never be produced by copying tenant snapshots into scoped populations.