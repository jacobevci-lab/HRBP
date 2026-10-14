# Audit verification coverage: resumable tenant traversal (partial #215)

## What is verified

Scheduled `audit-integrity` maintenance verifies a bounded ledger tail per selected tenant. `AuditVerificationProgress` distinguishes the latest attempt from the latest confirmed success, preserving the exact repeatable-read sequence, scope (`EMPTY`, `GENESIS`, `TAIL`), checked count and last-known-good watermark. An invalid result preserves the previous good watermark and queues the existing restricted Tenant Admin notification. The maintenance invocation remains RED. TAIL is not whole-history integrity.

The descriptive 24-hour `verifiedWithin24h` / `staleOrUnverified24h` aggregates still count missing receipts and latest-invalid tenants as unverified. They are not a guaranteed enterprise coverage SLA. A new successful tail check cannot prove that an old historical gap was checked.

## Durable selection instead of time-slot rotation

`AuditVerificationSchedule` is a deployment-level internal record. It contains a version, the last committed `(createdAt, id)` tenant key, a fixed upper tenant key for the current traversal, cycle timestamps and a short ownership lease. It stores neither employee event bodies nor cryptographic signing keys. These internal tenant keys and lease credentials are never returned in maintenance metrics or tenant APIs.

Each invocation resumes after the last committed key rather than deriving an offset from the UTC clock. A missed schedule does not skip that invocation's tenants. Within a page, each success receipt or failure receipt plus notification is committed in the **same short PostgreSQL transaction as the cursor**. An interrupted or rolled-back tenant remains pending; earlier committed tenants are not repeated just because the rest of the page was interrupted. Audit hashing stays outside these write transactions in its existing repeatable-read snapshot.

A recorded INVALID result advances selection while retaining its restricted alert and RED run result, so one corrupt ledger does not starve every later tenant. A verifier exception, missing/unsafe watermark, failed receipt, notification error or ownership conflict does not advance that tenant. Persistent processing errors can therefore stall traversal and require operator action; they are not silently accepted or skipped.

The original event budget remains: at most 10,000 checked events per invocation, plus the existing predecessor anchor per tenant, default four tenants at 1,500 events each. Selection reads at most 25 tenant metadata rows plus **one unprocessed lookahead**, never the full tenant population. No full-history scan was added to the scheduled Worker path.

## Ownership, expiry and concurrency

Only one invocation owns the scheduler key at a time. The database clock sets a fixed 120-second lease. Row locks are held only in transactions configured with 2-second acquisition wait / 5-second transaction budgets, not throughout ledger hashing. Each checkpoint checks the current random owner token, version, expected cursor and upper boundary under the row lock. It checks lease expiry again after the receipt/outbox callback; an expired callback rolls back along with its cursor change.

A process that disappears leaves its lease to expire. A later normally scheduled invocation can reacquire ownership and resume from the committed cursor. An old process cannot advance or release the new owner's lease. There is no automatic retry of an HTTP POST with unknown outcome. Multiple schedulers must target the same database and default internal key. Leases are coordination, not exactly-once execution or an independently trusted audit checkpoint.

Operational diagnostics include `AUDIT_SCHEDULE_BUSY`, `AUDIT_SCHEDULE_LEASE_LOST`, `AUDIT_SCHEDULE_INCOMPLETE`, `AUDIT_SCHEDULE_ORDER_INVALID`, `AUDIT_SCHEDULE_STATE_INVALID` and `AUDIT_SCHEDULE_VERSION_UNSUPPORTED`. These fail the job, not a falsely green zero-work response. Do not publish raw database errors, tokens or internal cursor keys.

## Finite traversal and changing populations

At a new traversal, the highest currently visible tenant key becomes the upper bound. New tenants beyond that key wait for the next traversal; inserts behind an already committed cursor are also picked up in the next traversal. This prevents continuing growth from indefinitely extending the current traversal. It is not a membership snapshot: backdated or late-committing rows can join a later traversal. Tenant creation timestamps are expected to remain immutable in normal operation.

Cursor and upper keys are values, deliberately not foreign keys. Deleting either referenced tenant does not reset progress or prevent keyset continuation. A tenant deleted after selection may cause a transactional foreign-key error; the next invocation selects live rows and proceeds without rewriting audit evidence. A traversal completes only after the selected page has fully committed and there is no metadata lookahead. A crash between the last checkpoint and finalization can require an additional zero-row invocation to complete that traversal.

`selectionMode: DURABLE_KEYSET`, `scheduleVersion: 1` and `cycleCompleted` replace misleading wall-clock batch-index reporting. A completed traversal can contain recorded INVALID outcomes or no tenants. It does **not** mean all ledgers are healthy, every possible tenant mutation was covered, or full historical verification succeeded. Use receipt freshness and failure metrics, not cycle completion alone.

## Receipt ordering and safe recovery

Conditional parameter-bound receipt updates retain the previous milestone's guards: older successes cannot overwrite newer attempts; confirmed sequences cannot regress; INVALID wins at equal invocation timestamps; duplicate failures do not inflate counters; failure counters saturate safely. A rejected success raises `AUDIT_VERIFICATION_PROGRESS_CONFLICT`, retains prior evidence and does not advance selection.

Receipts use the internally supplied invocation-start timestamp. Keep application clocks synchronized even though lease ownership uses the database clock. A progress conflict alone is not proof of malicious tampering: investigate overlapping/mixed-version deployments, clock changes and restored databases. Do not rewrite historical audit events or reset the cursor/receipt merely to obtain green output.

Deploy the additive `20261014190000_audit_verification_schedule` migration through committed Prisma history before starting the new application; never use `prisma db push` in production. Quiesce old maintenance workers during rollout/rollback: older binaries do not participate in this lease protocol. An unknown stored schedule version fails closed rather than silently resetting coverage. Back up/restore operational scheduler state with the database and follow approved recovery procedures. A restored database can be behind external systems; neither the cursor nor receipts establish an external trust root.

## Verification and remaining boundaries

The existing prebuild audit gate runs monitoring/receipt tests and the new executable scheduler suite. The disposable, localhost-only PostgreSQL integration now runs the real scheduler and monitor together: partial completion and downtime resume, notification rollback, invalid-result traversal, monotonic receipt rejection, competing acquisitions, lease expiry during receipt work, late-owner rejection, cursor/upper deletion, inserted tenants, first-row races, unknown versions and empty traversal. Unit doubles do not substitute for these SQL checks or customer environment acceptance.

#215 is still partial: independently signed checkpoints, immutable off-platform archives, historical full-scan scheduling/resume, evidence retention policy and a trusted customer/SIEM export boundary remain outstanding. The separate opt-in full-history operator tool is described in `docs/maintenance-operations.md`; it has not become a resumable cross-run full-history scanner in this release. This is an on-prem operational improvement, not a new SaaS tenancy feature.

Production maintenance HTTP 503 root cause (#209), Cloudflare provider build/deployed-revision verification (#220), and customer pilot GO/NO-GO are separate. Successful GitHub CI or a completed tenant traversal does not prove deployment or customer UAT.
