# Integration evidence for stacked pull requests

The dedicated Audit Pilot Gate runs the focused offline suites on every PR base.
It does not establish application build, database integration or dependency-audit
success. Existing CI and security/release/platform workflows filter PRs to `main`.
A stack targeting a feature or documentation branch therefore needs integration
checks before it can safely be described as a build-validated candidate.

`Stacked Integration` runs on `pull_request` targeting any branch except `main`.
It supplements, never replaces or edits, the existing main-targeted workflows.
Draft PRs are included. It uses the default PR **merge candidate**, not a mutable
head checkout, and records head, base and merge SHAs; checkout HEAD must equal
the recorded merge SHA. Results belong to that exact combination of revisions.

## Mandatory work

The application job installs the committed npm graph, starts disposable local
PostgreSQL, validates Prisma and the versioned migration lifecycle, applies
committed migrations, executes the four real audit-ledger PostgreSQL suites and
four governed lifecycle/identity suites already used by main CI, type-checks the
application, runs the existing full prebuild and Next build, builds OpenNext,
checks Worker packaging with `wrangler deploy --dry-run`, then starts the built
Worker locally and exercises HTTP authorization and a real PostgreSQL metrics read.

The independent dependency job performs the existing production and full npm
audits. It does not change advisory thresholds, overrides or the lockfile.
Separation lets a dependency finding remain visible without concealing unrelated
application results. Either job failing still denies the aggregate result.

Both jobs first run the eight dependency-free workflow contract tests. The
aggregate result uses `always()` and requires both upstream results to equal
`success`; failure, cancellation, skipped work and unknown status do not pass.
The actual aggregate shell is tested over all 36 status pairs.

## Local Worker HTTP smoke

Before installation, the application job also runs the dependency-free
`stacked-worker-smoke.test.mjs` and `stacked-worker-maintenance.test.mjs` suites. After packaging, the mandatory
`stacked-worker-smoke.mjs` harness starts the installed Wrangler with `dev --local`.
This is the compiled OpenNext Worker under workerd, not a mocked HTTP application.

The initial seven checks require two fresh health responses carrying the exact tested
merge SHA, reject both missing and incorrect credentials on metrics and audit
history, and perform an authenticated read of operational metrics. The metrics
handler queries the migrated disposable PostgreSQL database through the Worker
Prisma adapter; HTTP 200 alone is insufficient. The success indicator and expected
audit/notification metric families must exist. The harness then runs ten mandatory
maintenance checks and another fresh health probe: **18 runtime checks** in total.
No customer-data write is performed.

The harness requires explicit disposable opt-in and the exact CI database URL.
Its temporary configuration copies only reviewed runtime compatibility settings,
uses the generated bundle/assets and a synthetic Hyperdrive ID, and fixes the
connection string to localhost. It does not copy provider resources or source
vars. The child has an allowlisted environment, isolated HOME, empty `.dev.vars`
and disabled dotenv/process-environment loading. It never overrides the compiled
build revision. Existing production configuration is not rewritten.

The original three loopback paths retain their five-second timeout and 512 KiB
body limit. Maintenance requests use a separate exact path/query allowlist, a
30-second timeout and a 32 KiB JSON limit. Neither transport follows redirects. Startup retries
only transient unavailability; malformed successful responses and wrong source
identities fail immediately. The entire harness has a 180-second abort deadline.
The fixed port must initially be free. Diagnostics retain only a bounded tail;
synthetic tokens and the local connection string are redacted on failure. Cleanup
terminates the Linux process group and removes temporary files, including on
normal SIGINT/SIGTERM. A forcibly killed runner relies on runner teardown.

These are CI regression guardrails, not a security sandbox against malicious
repository code or hostile processes on the runner. The port preflight has a
local check/start race. A revision echo and nonce establish a regression check,
not independent provider-origin authentication. No Hyperdrive cloud pooling,
cache behavior or actual Cloudflare deployment is established. Both
`releaseAuthorized` and `productionDeployed` remain false in the result.

Cloudflare reference behavior: `dev --local` disables remote bindings, but a
Hyperdrive local connection string can itself point to a remote database. This
is why the harness pins the full local URL instead of trusting the mode alone.
See https://developers.cloudflare.com/workers/wrangler/commands/workers/ ,
https://developers.cloudflare.com/hyperdrive/configuration/local-development/
and https://developers.cloudflare.com/workers/local-development/environment-variables/ .

## Maintenance write/readback regression

After initial Worker readiness and PostgreSQL metrics checks, the harness creates
one randomly named synthetic tenant and four IN_APP notifications in an atomic
transaction on the fixed disposable database. No email credentials are available.
The fixtures are a due pending message, an expired read message, a future pending
message and a 200-day-old unread delivered message that is still within retention.

Four missing/invalid-token GET/POST cases require HTTP 401; empty, unknown and
duplicate selectors require HTTP 400. The authenticated capability GET must match
the shared protocol and supported job inventory. After each of these eight
requests, direct database readback must show the fixture rows unchanged. This
checks these run-owned rows, not every table or every tenant in the database.

Only an explicitly selected operational-maintenance POST is executed. The
legacy selector-free all-jobs POST is refused by the test transport. A successful
HTTP response and single-job execution envelope are necessary but not sufficient:
direct Prisma readback must show one delivery attempt with a delivery timestamp,
no stale lock/error, removal of the expired read message, and byte-for-byte
snapshot preservation of the future and retained unread rows. A second POST must
leave all three remaining snapshots unchanged. These are notification delivery
and retention checks, not coverage of every operational-maintenance domain.

The fixture client uses an explicit pinned local datasource URL with one
connection, five-second connection/pool timeouts, a ten-second socket timeout,
and bounded transactions. The opt-in, CI context and exact database/source are
checked before any fixture write. The runtime HTTP requests share the existing
180-second cancellation signal and process-liveness checks. Query timeouts and
runner teardown remain the backstop for database cleanup after cancellation.

Cleanup stops the Worker process group first, deletes only this run's synthetic
tenant/notifications in a transaction, disconnects Prisma, and removes temporary
files. Cleanup failure keeps the job unsuccessful. A killed runner relies on
runner teardown. No global database reset or production database is used. Normal
CLI errors are bounded codes rather than raw Prisma/SQL/response payloads.

The new dependency-free unit tests include HTTP error responses that still
mutate data, false success without persisted writes, protected-row corruption,
re-delivery, cancellation, and an actual loopback redirect denial. Those unit
fakes are not real Worker evidence: the mandatory post-build CI harness must
complete on the exact PR merge candidate before runtime success is claimed.

## Safety and limitations

Permissions remain `contents: read`; checkout credentials are not persisted.
Actions reuse the exact checkout/setup-node pins already enrolled by the
repository's Security Assurance workflow. No secret references, production
endpoints, cloud credentials, remote migration or publishing step are introduced.
Synthetic CI tokens and a localhost test database are not customer credentials.
Each job is bounded, and newer PR updates cancel superseded work.

Success is NOT live deployment, Cloudflare provider-build success, deployed HTTP
smoke coverage, on-prem Docker acceptance, CodeQL, complete platform/browser
regression, customer acceptance or legal approval. The other release gates are
still required. In particular this workflow alone cannot close #209 or #220.

Branch protection/rulesets are unchanged: this adds an enforced workflow result,
not an automatically installed repository merge rule. Do not require this
branch-filtered workflow for main PRs; the original main workflows cover those.
No workflow result should be reused after either the head or base changes.

Primary semantics: GitHub Docs, "Events that trigger workflows" (pull_request
merge refs) and "Using jobs in a workflow" (needs/always). See
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
and https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs .
