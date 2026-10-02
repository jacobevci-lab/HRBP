# Operational maintenance: bounded execution and safe recovery

## Why this changed

The scheduled run on 2 October 2026 (`37014211152`) returned HTTP 503 with
Cloudflare error 1102. That establishes a Worker resource-limit failure, not
which domain exceeded CPU or memory. The previous scheduler submitted all
maintenance work in one POST and automatically retried failed POST requests.

This change reduces aggregate work per scheduled invocation and makes each
failed domain identifiable. It does **not** prove that every individual domain
fits the deployed Worker's resource budget. Profile any remaining 1102 failures
before changing batch sizes or platform limits. No Cloudflare plan, CPU limit,
production secret, database schema or customer data is changed by this patch.

## Protocol

Both methods on `/api/internal/maintenance` require the existing
`HRBP_MAINTENANCE_TOKEN` bearer credential and return `Cache-Control: no-store`.

* `GET` returns the protocol version and ordered job manifest. It does not load
  domain modules or execute maintenance. The scheduler refuses to issue writes
  if this capability probe does not match its local contract.
* `POST ?job=<name>` executes exactly one allowlisted job. Empty, unknown and
  repeated `job` parameters return HTTP 400, never an all-jobs fallback.
* `POST` without a selector remains the compatibility all-jobs endpoint and
  preserves existing `data` keys. This heavier mode is not used by the scheduler.

`lib/maintenance-protocol.mjs` is the shared runtime contract. Its `.d.mts`
companion supplies application types. Jobs execute serially, including in
compatibility mode. Existing domain authorization boundaries, audit writes,
notification deduplication and lifecycle transition predicates are unchanged.
The current `operational-maintenance` job still groups service escalation,
policy expiry/retirement, dispatch and retention. It can require further
subdivision if profiling identifies it as the remaining hot path.

## Scheduling and recovery

The existing 15-minute schedule is retained. The runner performs one
capability GET, then one POST per selected job in manifest order. Audited jobs
are not launched concurrently; the existing workflow concurrency group also
serializes scheduled and manual invocations. This is not a distributed lock
against unrelated external callers.

Use the workflow's `job` choice to rerun a **single inspected job** rather than
replaying the entire maintenance pass. The `all` choice still sends individual
requests; it does not call the compatibility all-jobs endpoint.

The runner never automatically retries a POST:

| Diagnostic | Behavior / required action |
| --- | --- |
| `JOB_FAILED` | A structured domain failure was returned. Later domains continue; the overall workflow stays failed. Inspect domain diagnostics before a targeted rerun. |
| `WORKER_RESOURCE_LIMIT_1102` | The selected Worker invocation returned 503/1102. Later domains continue. Profile the named domain; splitting the dispatcher cannot cure an oversized individual job. |
| `OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY` | Transport failure, timeout or unreadable/oversized response. Stop the sequence. Check audit/outbox/state before retrying because a transaction may already have committed. |
| `PROTOCOL_UNAVAILABLE_DEPLOY_REQUIRED` | The capability probe failed or the deployment is incompatible. No POST is sent. Verify the Worker release and credentials. |
| `UNEXPECTED_RESPONSE_STOPPED` | Authentication failure, malformed response or changed deployment contract after preflight. Stop safely and investigate. |

Requests time out after 90 seconds. The workflow has a 20-minute limit.
Credentials are never sent across redirects. Response reads are bounded at
64 KiB. Logs and the Actions summary contain allowlisted job names, status,
HTTP code, elapsed wall time and bounded diagnostic identifiers—not raw
response bodies, SQL, employee records or bearer tokens. Wall time is not CPU
time. An incomplete run remains failed; it is not reported as successful.

## Deployment order

Deploy the updated Worker route **before** relying on the new scheduler.
Publishing a Git commit or obtaining green CI does not itself prove that a
Cloudflare deployment occurred. A scheduler pointed at an older Worker fails
its preflight without issuing writes, instead of accidentally running all
legacy maintenance jobs once for each requested job.

No production invocation is necessary for unit tests. The smoke script is
hard-coded to `127.0.0.1:8787`; production scheduling requires HTTPS.

## Verification

`node --test scripts/maintenance-protocol.test.mjs` executes the actual shared
orchestrator and scheduler against deterministic transports. It covers
selection, serial execution, isolated failures, incompatible deployments,
resource limits, auth/response errors, unknown outcomes, response bounds and
safe diagnostics.

`npm run maintenance:validate` checks application/CI wiring and runs these
behavioral tests. CI additionally runs
`node scripts/smoke-maintenance-protocol.mjs` against the built local Worker and
PostgreSQL, followed by the original no-selector request. Existing database
assertions still require exactly-once notification delivery and stale-read
notification retention. Passing a local Worker test is not a measurement of
production CPU or memory usage.

## HR service SLA correctness

Candidate selection now filters for a genuinely higher escalation level in the
SQL predicate **before** the batch limit. Previously, a full batch of old,
already-escalated requests could prevent later actionable requests from being
considered. Deadline and escalation thresholds use the same exact millisecond
boundaries in selection and evaluation; a request due in 59 seconds is no
longer classified as breached by minute rounding.

The transactional update compares the scanned SLA deadline, queue and assignee
as well as tenant, record identity, escalation level and open status. If a human
changed those values in the meantime, the update is skipped and the request is
re-evaluated on the next pass rather than overwriting a newer assignment.

Fourteen additional tests cover boundary conditions, candidate-selection
consistency, saturated batches and the stale-write query contract. These are
unit/query-wiring tests, not a production concurrency or load test.
