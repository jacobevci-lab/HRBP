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
and checks Worker packaging with `wrangler deploy --dry-run` only.

The independent dependency job performs the existing production and full npm
audits. It does not change advisory thresholds, overrides or the lockfile.
Separation lets a dependency finding remain visible without concealing unrelated
application results. Either job failing still denies the aggregate result.

Both jobs first run the eight dependency-free workflow contract tests. The
aggregate result uses `always()` and requires both upstream results to equal
`success`; failure, cancellation, skipped work and unknown status do not pass.
The actual aggregate shell is tested over all 36 status pairs.

## Safety and limitations

Permissions remain `contents: read`; checkout credentials are not persisted.
Actions reuse the exact checkout/setup-node pins already enrolled by the
repository's Security Assurance workflow. No secret references, production
endpoints, cloud credentials, remote migration or publishing step are introduced.
Synthetic CI tokens and a localhost test database are not customer credentials.
Each job is bounded, and newer PR updates cancel superseded work.

Success is NOT live deployment, Cloudflare provider-build success, runtime HTTP
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
