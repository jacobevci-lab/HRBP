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
| `HTTP_503_UNCLASSIFIED_STOPPED` | The selected job returned HTTP 503 without a confirmed 1102 signature. Stop subsequent jobs and do not auto-retry; determine whether the deployment/edge rejected the request or the handler may have run, then inspect audit, outbox and database outcomes. |
| `OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY` | Transport failure, timeout or unreadable/oversized response. Stop the sequence. Check audit/outbox/state before retrying because a transaction may already have committed. |
| `PROTOCOL_UNAVAILABLE_DEPLOY_REQUIRED` | The capability probe failed or the deployment is incompatible. No POST is sent. Verify the Worker release and credentials. |
| `UNEXPECTED_RESPONSE_STOPPED` | Authentication failure, malformed response or changed deployment contract after preflight. Stop safely and investigate. |

Requests time out after 90 seconds. The workflow has a 20-minute limit.
Credentials are never sent across redirects. Response reads are bounded at
64 KiB. Logs and the Actions summary contain allowlisted job names, status,
HTTP code, elapsed wall time and bounded diagnostic identifiers—not raw
response bodies, SQL, employee records or bearer tokens. Wall time is not CPU
time. An incomplete run remains failed; it is not reported as successful.

## 14 October audit-integrity incident evidence

One scheduled invocation (14 October 2026, 00:29 UTC, GitHub run `38490439003`) returned HTTP 503 for `audit-integrity` after prior maintenance domains succeeded. The existing safe runner reported `UNEXPECTED_RESPONSE_STOPPED`. The response did **not** contain a confirmed Cloudflare 1102 signature. A later scheduled invocation (`38515821818`) returned HTTP 200 for the audit-integrity job. This does not establish the root cause and is not evidence of a ledger compromise.

For another unclassified 503: preserve the failing run ID, selected job and timestamp, inspect the exact deployed Worker/edge logs and database connection health in the same time window, confirm the audit ledger and notification outbox state, and verify the last completed job before deciding whether to manually trigger **only** the affected maintenance job. Do not replay `all`, infer that 503 guarantees rollback, or disable audit verification to turn the workflow green. Escalate repeated 503 events to a load/resource and edge availability investigation with tenant-safe diagnostics.

## Bounded rotating audit-integrity verification

The audit-monitoring job checks the integrity verifier's `valid` flag **before** treating an `EMPTY` ledger as healthy. A tenant with a nonzero ledger state and zero matching audit events is therefore **not** quietly skipped: it generates the existing restricted `AUDIT_INTEGRITY_FAILURE` notification for the tenant's authorized administrators. Do not suppress that finding or reset the ledger state.

Each invocation uses the durable `AuditVerificationSchedule` keyset cursor in stable `createdAt, id` order. The cursor and the per-tenant verification receipt are committed in the same fenced transaction; a missed scheduler slot therefore does not discard the tenant position, and new/removed tenants are picked up on the next finite cycle. The effective batch remains capped by a **10,000 verified-event** per-invocation budget (excluding one predecessor anchor per tenant), regardless of the configured tenant batch-size request. With the example settings (1,500 events, four tenants), one selected maintenance run verifies at most 6,000 events plus anchors. The `HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE` example default is 4; values above 25 are clamped. No tenant IDs or event payloads are added to maintenance telemetry.

**Important limits:** this fast monitor still verifies a bounded tail, not the complete historical chain. Durable cursor coverage means skipped wall-clock runs resume safely; it does not turn a tail result into proof that older history is valid. Complete-history coverage is the separate fixed-watermark process below, while independently signed checkpoints remain a different trust domain. The 14 October intermittent 503 still requires the separate root-cause investigation in issue #209.

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

## Complete-history audit verification: scheduled resumable coverage and manual evidence

The 15-minute `audit-integrity` maintenance job intentionally verifies a bounded **tail** of selected tenant ledgers, not all historical events. A customer-approved operator can additionally run:

```bash
docker compose --env-file .env.onprem -f docker-compose.onprem.yml run --rm --no-deps -T schema \
  node scripts/audit-full-history-verification.mjs --tenant-id <TENANT_ID> --max-events 50000 --batch-size 250 --acknowledge-read-only-scan
```

This command uses the current built `schema` Compose tooling image (the stripped `app` image excludes maintenance scripts), so the private `DATABASE_URL` is available without exposing it to the host. Use `--no-deps` only while the on-prem PostgreSQL stack is already healthy; no service or migration is started by this command. An alternative bare-host `npm run audit:full:verify -- ...` requires an explicitly configured approved `DATABASE_URL`. The scan selects one tenant by a bound SQL parameter, and uses a PostgreSQL `REPEATABLE READ READ ONLY` transaction. It traverses events from genesis using a bounded keyset page and validates sequence, linkage, recomputed content hash and the persisted state tail. Default workload is limited to 50,000 events (maximum 1 million by explicit option), 250 events per query (max 1,000), 45 seconds elapsed and a per-statement timeout. It always rolls back the read-only transaction. A budget, timeout, missing tenant or inconsistent chain exits nonzero; it must never be recorded as a completed verification.

Only aggregate status and sequence/count are printed; SQL errors, employee payloads, tenant IDs and connection strings are never logged. Run the manual command only on approved customer infrastructure, outside peak load. It remains useful for operator investigations and checkpoint creation, and it does not make a production deployment healthy by itself.

Routine complete-history coverage is now separate from both the fast maintenance job and this manual command. The on-prem `audit-history-scheduler` calls only `/api/internal/audit-history`. Each call processes one bounded page for one tenant against a fixed `eventCount/tailHash` target. Partial progress is committed without advancing the tenant cursor, so the next invocation resumes the same tenant and first revalidates the saved hash anchor. Normal audit appends after the captured target are not blocked and are deferred to the next complete scan.

Operational controls:

- `HRBP_AUDIT_FULL_HISTORY_PAGE_SIZE=250` by default, hard maximum 1,000 events per invocation.
- `HRBP_AUDIT_HISTORY_SCHEDULER_INTERVAL_SECONDS=900` by default; this is a separate process/cadence from `maintenance-scheduler`.
- `HRBP_AUDIT_FULL_HISTORY_INTERVAL_HOURS=168` prevents a successfully completed tenant from being rescanned until the weekly interval expires.
- an unknown POST outcome is **not** immediately replayed; the next normal scheduler cycle resumes from database-fenced state.
- private metrics expose only aggregate live coverage/backlog/throughput. Progress retained for a deleted tenant is counted separately as orphaned operational evidence and is excluded from live tenant coverage.

**Trust boundary:** `AuditHistoryVerificationProgress` and its target hash live in the same application PostgreSQL trust domain as the ledger. They are operational resume state, not an independently trusted checkpoint. The Ed25519 checkpoint workflow in `docs/AUDIT-CHECKPOINTS.md` still performs its own complete read-only scan on the independently administered signer before signing. Do not delete/rewrite audit events or reset progress to hide an integrity error. #215 remains open for approved external key custody, immutable checkpoint retention/export, evidence-retention policy, representative production load measurements and any required HSM/KMS signer custody.

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

## Integrity failure is a failed maintenance run

If the audit verifier detects an invalid chain, it must enqueue the existing tenant-scoped administrator notification and **fail** the selected audit-integrity job after that alert is committed. A successful notification is not evidence the ledger is valid. The maintenance endpoint must return its bounded `AUDIT_INTEGRITY_FAILURE` diagnostic (HTTP 500 in the protocol), so the scheduler stays red without automatic POST retries. An invalid or contradictory summary fails closed with `AUDIT_INTEGRITY_RESULT_INVALID`. Do not reset ledger state, disable verification, or mark such a run as successful.
