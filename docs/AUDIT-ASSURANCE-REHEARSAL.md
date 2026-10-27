# Multi-tenant audit assurance rehearsal

This rehearsal is a **synthetic, bounded customer-like acceptance exercise** for the audit assurance stack. It is not a production load test, not customer UAT, and not proof of real HSM/KMS, trusted timestamp, or WORM retention controls.

## Scope

The mandatory PostgreSQL rehearsal runs only when:

- `CI=true`
- `HRBP_DISPOSABLE_AUDIT_LEDGER_TEST=true`
- `DATABASE_URL` points to localhost/127.0.0.1
- database name is exactly `/hrbp`

It creates:

- **8 disposable tenants**
- **24 audit events per tenant before checkpoint**
- one independently signed checkpoint per tenant
- **8 additional legitimate events per tenant**
- **32 final events per tenant**

Total exercised history: **256 audit events** across eight independently scoped ledgers.

## Acceptance scenarios

### Baseline coverage

Every tenant receives a full read-only checkpoint scan and retained signed checkpoint at sequence 24.

All eight checkpoints must verify and compare successfully against the original ledgers.

### Legitimate post-checkpoint growth

Eight additional events are appended to each tenant.

Every retained checkpoint must still match its historical prefix while the current full scan validates all 32 events.

### Privileged full-chain rewrite

One tenant is rewritten from an early event onward. Every later hash and the ledger tail are recomputed, so a fresh unanchored full-history scan is internally valid.

The retained off-database checkpoint must still return:

`CHECKPOINT_HASH_MISMATCH`

This proves that a privileged database rewrite cannot be hidden merely by recomputing the chain and head.

### Internally consistent truncation

A second tenant is truncated below the retained checkpoint sequence and its ledger state is updated to match the shortened chain.

The shortened database remains internally consistent, but comparison against the retained checkpoint must return:

`CHECKPOINT_SEQUENCE_MISSING`

### Exact forensic restore

The two modified tenants are restored from their exact known-good synthetic snapshots.

After restore:

- fresh full-history verification must succeed;
- retained checkpoint comparison must succeed;
- all 32 events must again be visible.

This is a **forensic recovery rehearsal only**. HRBP never auto-rewrites or repairs production audit history.

## Evidence minimization

The emitted `AUDIT_ASSURANCE_REHEARSAL` summary contains only aggregate counts:

- tenant count;
- checkpoint depth;
- final depth;
- number of baseline successes;
- number of append successes;
- rewrite detections;
- truncation detections;
- restore successes.

Raw tenant IDs and the per-run UUID are explicitly prohibited from the summary.

## What this proves

Repository-side CI now proves that the combined audit design can:

- scan multiple tenant ledgers under real PostgreSQL;
- retain independent signed prefix anchors;
- tolerate legitimate appends;
- detect a fully rehashed historical rewrite;
- detect internally consistent truncation;
- recover to an exact known-good synthetic state and revalidate.

## What this does not prove

Do not use this rehearsal alone to claim:

- production scalability at customer event volumes;
- customer-specific RPO/RTO;
- HSM/KMS key custody;
- trusted timestamp authority enforcement;
- customer Object Lock/WORM configuration;
- actual immutable storage retention;
- legal/regulatory retention compliance;
- organizational human identity/separation;
- customer forensic acceptance.

Those remain deployment and customer-governance controls under #215.

## CI location

The rehearsal is mandatory inside:

`.github/workflows/ci.yml`

under:

`Verify concurrent audit ledger serialization and full history integrity`

The static contract is also included in `audit-integrity:validate`, so fixture size and required failure/recovery scenarios cannot silently disappear from the build.
