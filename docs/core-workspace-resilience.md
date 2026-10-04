# Core workspace failures without synthetic employee records

## Scope and evidence

The four dedicated pages `/module/people`, `/module/organization`,
`/module/positions`, and `/module/employee-360` previously caught live-workspace
exceptions and mounted `CoreHRWorkspace`, which reads synthetic demo data.
People and Positions also kept their create links available while claiming
protected mutations were disabled. This was established by source inspection;
it is not a measurement of how often a production user encountered the path.

The dedicated pages now let rendering/import/data exceptions propagate to
scoped Next.js `error.tsx` boundaries. The error panel contains neither sample
records nor zero-valued totals and replaces the failed page's action header.
Next.js retains ownership of redirect and not-found control flow; there is no
custom error classifier or unstable rethrow dependency.

The new panel is localized in English/Turkish, retains the navigation shell,
and offers an explicit reload of the current page or safe navigation away.
Reload preserves the address, query string and fragment. It does not preserve
unsaved form inputs. It never automatically retries or replays a write; repeated
clicks are guarded while reload is pending. No error object/digest is rendered
or passed to the shared component. No global body clipping or new palette is
used.

## Normal and public paths

Anonymous public previews remain intentionally available and clearly separate.
The existing `getServerRequestContext`/`PublicCoreLanding` short-circuit stays
before live rendering. Session-verification failure still uses the platform's
existing unauthenticated behavior; this patch does not redesign that contract.
Therefore these new error panels cover a failure after entering the dedicated
page's protected render, not every possible database or identity outage.

Healthy routes still call the original `CoreHRLiveWorkspace` with the same
search/person/tab arguments. Existing data scope and API authorization are
unchanged. People/Positions create links additionally require both their read
and write capabilities; this UI condition is not a replacement for API checks.
Employee 360 retains encoded person-specific lifecycle navigation for readable
records; its destination still controls which operations are allowed.

Core page headings now follow the server locale, and healthy-state labels are
text spans rather than disabled buttons. These labels are not health probes.
Other modules' fallback implementations, the generic ModuleLanding fallbacks,
public demo-only controls and complete platform localization are not changed.
The scoped error boundaries may also catch a nested core route's render error;
a fresh read, not replay of its form submission, is the recovery operation.

## Verification

`node --test scripts/core-workspace-resilience.test.mjs` executes the actual
TypeScript route/component modules with isolated identity, locale, capability
and workspace dependencies. It covers failure propagation, lazy-import errors,
framework-control-flow sentinel preservation, public short-circuiting, healthy
arguments, create-link visibility, localization, safe error output and reload
behavior. JSX and React state are instrumented fixtures; these are not real
React/Next browser outage, database concurrency or network failure tests.

The suite is part of the existing Platform Regression workflow. The unchanged
production-build browser/API sweeps remain required for healthy-flow regression,
along with standard CI, Prisma/TypeScript checks and local Worker packaging.
Final source-head results are recorded in the pull request. Green tests alone
do not establish a live Cloudflare rollout or solve its separate build failure.

No production data, schema, dependency, secret or provider setting changes.
