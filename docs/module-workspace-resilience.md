# Generic module rendering: live failures are not demo successes

## Scope

This continues PR #97 for the shared ModuleLanding dispatcher used by documents,
HR service, employee relations, policies, workflows, recruiting, onboarding and
other generic module surfaces. Previously this dispatcher caught live loader
errors and selected synthetic CoreHRWorkspace or EmployeeServicesWorkspace data.
Its standard fallback also exposed inert New record / Filters / View architecture
controls. The four dedicated core pages were already handled in PR #97.

The dispatcher now imports live implementations only, preserves their original
query/person/mode arguments and propagates rendering/import errors intact. Its
scoped Next error boundary replaces the generic page, including sibling panels,
with a localized read-only recovery screen. Redirect/not-found control flow is
not swallowed by application catches. A null/unsupported live result is an error,
not a successful empty demo. Dedicated work/pay, growth and governance page
routing is unchanged; unreachable demo dispatch branches and their unused copy
were removed. This is not a rewrite of those dedicated modules' inner catches.

The current identity and existing capability are checked before dispatching.
Anonymous PublicModuleLanding previews remain explicitly separate. Domain case
walls, population scopes and API authorization are unchanged. A status label is
not a proof that every subdependency is healthy. The generic layout accepts the
known navigation catalog plus notifications; dashboard is canonicalized to /
and unknown names use the framework not-found path.

## Recovery

No synthetic records, zero totals, raw exceptions or mutation controls appear in
the recovery panel. It offers an explicit page reload and navigation home. Reload
preserves URL/query/fragment, not unsaved input; it does not replay a submitted
API operation. It cannot determine whether an earlier failed operation committed,
so the panel explicitly instructs users to inspect an unknown result before
resubmitting. Repeat clicks are guarded; there is no automatic retry.

## Verification

82 local unit/wiring cases execute the actual TS dispatcher/layout/boundary with
controlled dependencies. They test successful routing, import/data failures,
framework-control-flow preservation, anonymous/denied short-circuits, create-link
capabilities, locale/focus, unsupported/empty results and recovery behavior. These
are not 82 complete browser workflows.

The mandatory browser stage adds 64 healthy cases (eight modules, four roles,
two locales at 390px), rejects error panels even with HTTP 200, checks identity
and viewport fit, and exercises unknown routes/dashboard canonicalization.
Restricted role views are not reported as successful CRUD workflows.

A separate part of the same stage injects a REAL reversible table fault only in
PostgreSQL hrbp_audit on loopback, behind HRBP_DISPOSABLE_AUDIT=true and a fixed
advisory lock. The fixed HRServiceRequest table is renamed, leaving UserAccount
available so authentication succeeds. The browser must show the localized error
panel without sample metrics or raw SQL. The table is restored in finally; the
user's explicit reload must recover the live view with its URL and identity.
Both EN/TR cases and unchanged row count are required. This is a missing-table
fault, not a full database/identity outage, concurrency test or production load
test. An externally killed CI process may not run finally; the entire database
is disposable and destroyed with the job.

Existing broad API/browser, core-workspace and remediation gates remain required.
Current-head full CI/real browser results are recorded in the PR, not inferred
from local unit tests. No production data, schema migration, dependency, secret
or provider-setting change is included. The separate Cloudflare provider build
failure is not solved by this patch; merge and live rollout remain distinct.
