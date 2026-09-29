# Joiner / Leaver Action Center continuity

## Scope

This increment connects the governed Onboarding and Offboarding execution planes to the shared Lifecycle Action Center. It does not create a parallel decision engine and it does not move candidate, exit-interview, settlement, evidence or other restricted detail into a broad queue.

## Onboarding attention

Onboarding attention is available only to actors with `onboarding:write` and is built from the same population scope, ordering and 100-plan bound used by the owning onboarding operations workspace.

The shared queue surfaces:

- blocked onboarding tasks;
- open onboarding tasks inside the configured `HRBP_ONBOARDING_DUE_SOON_HOURS` horizon;
- start-readiness risk inside `HRBP_ONBOARDING_START_RISK_HOURS` when the signed plan owner has outstanding controls and no more specific task alert already represents the plan;
- completed onboarding plans that are still `PREBOARDING` and approaching/reaching the governed start date, so HR can perform the explicit activation handoff.

Task accountability mirrors reminder ownership. Manager-owned tasks resolve to the active manager user when one exists; otherwise the plan owner remains the fallback recipient. Other tasks remain plan-owner attention. Sensitive onboarding task titles are replaced with a generic restricted label in the shared queue.

Action Center never activates employment or changes task state. It deep-links to the existing onboarding operations console, where the existing state machine, scope checks, reason requirements, audit evidence and activation gate remain authoritative.

## Offboarding attention

Offboarding attention requires `offboarding:write` and reuses the same employment relationship scope, active-process population, ordering and 150-process bound as the owning offboarding workspace.

The queue surfaces:

- blocked or due-soon exit tasks for their explicit owner;
- unassigned exit tasks only to the same domain fallback role used by scheduled reminders (`PAYROLL_ADMIN`, `LEGAL`, otherwise `HR_OPERATIONS`);
- exit-readiness risk for the process initiator when the last working date is approaching and blocking task, asset, access or knowledge-transfer controls remain open;
- final independent closure attention only after the process is `READY_TO_CLOSE`, the last working date has arrived, all counted exit controls are clear, final settlement is settled and the signed actor is not the process initiator.

No exit-interview narrative, replacement rationale, settlement note/amount, asset condition note, access exception reason, evidence reference or rehire rationale is loaded into the shared attention projection.

Action Center never closes a separation, terminates employment, waives a control, settles final pay or changes any offboarding record. All mutations remain inside the existing governed offboarding APIs.

## Exact deep links

Native joiner/leaver items are deep-link only:

- onboarding task: `/module/onboarding?task=<id>`
- onboarding plan: `/module/onboarding?plan=<id>`
- offboarding task: `/module/offboarding?task=<id>`
- offboarding process: `/module/offboarding?process=<id>`

The owning consoles resolve those identifiers only against their already scoped and bounded server-side workspaces. They do not issue an unscoped primary-key fallback. A stale or inaccessible identifier therefore produces an unresolved-context notice instead of widening access.

## Shared source contract

For compatibility with the current Action Center UI union, these native joiner/leaver records use the existing deep-link-only `workflow` action kind while retaining explicit `module`, `subjectType` and subject identifiers. The continuity summary additionally exposes distinct `onboarding` and `offboarding` counters. Dashboard and Analytics receive only those aggregate counters.

This compatibility choice does not convert the records into WorkflowTask mutations: `action` is always `null` for joiner/leaver items.

## Failure behavior

Onboarding and Offboarding aggregation fail independently. A failure in one source does not suppress the core Action Center, growth attention or the other joiner/leaver source. The combined queue remains bounded to 300 rows.

## Validation

`npm run joiner-leaver-action-center:validate` checks authorization, relationship/population scope reuse, reminder horizons, actor accountability, bounded reads, deep-link-only behavior, sensitive-data minimization, independent offboarding closure, aggregate-only Dashboard/Analytics continuity and the no-broad-fallback contract.
