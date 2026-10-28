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
`stacked-worker-smoke.test.mjs` suite. After packaging, the mandatory
`stacked-worker-smoke.mjs` harness starts the installed Wrangler with `dev --local`.
This is the compiled OpenNext Worker under workerd, not a mocked HTTP application.

The seven checks require two fresh health responses carrying the exact tested
merge SHA, reject both missing and incorrect credentials on metrics and audit
history, and perform an authenticated read of operational metrics. The metrics
handler queries the migrated disposable PostgreSQL database through the Worker
Prisma adapter; HTTP 200 alone is insufficient. The success indicator and expected
audit/notification metric families must exist. No authenticated maintenance POST
or customer-data write is performed by this harness.

The harness requires explicit disposable opt-in and the exact CI database URL.
Its temporary configuration copies only reviewed runtime compatibility settings,
uses the generated bundle/assets and a synthetic Hyperdrive ID, and fixes the
connection string to localhost. It does not copy provider resources or source
vars. The child has an allowlisted environment, isolated HOME, empty `.dev.vars`
and disabled dotenv/process-environment loading. It never overrides the compiled
build revision. Existing production configuration is not rewritten.

Requests are limited to three fixed loopback paths; redirects are not followed.
Each request has a five-second timeout and a 512 KiB body limit. Startup retries
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
