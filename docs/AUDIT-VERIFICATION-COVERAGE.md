# Audit verification coverage: durable tenant receipts (partial #215)

## What this adds

Every selected tenant in the bounded, rotating `audit-integrity` maintenance job receives an operational `AuditVerificationProgress` record. Records distinguish the **latest attempt** from the **latest confirmed success**. On an integrity failure, the receipt and the existing restricted Tenant Admin notification are written inside the same transaction, then the maintenance job fails instead of reporting green.

A successful record preserves the exact audit-ledger sequence obtained from the verifier's PostgreSQL repeatable-read snapshot, the scope (`EMPTY`, `GENESIS`, or `TAIL`), the checked-event count and the timestamp. `TAIL` is **not** evidence that the chain was checked from genesis. A failure updates last attempt, result, failure timestamp and consecutive failure count **without erasing** the previous good watermark.

The internal maintenance job also returns aggregate-only `verifiedWithin24h` and `staleOrUnverified24h` counts. Unchecked tenants, including newly created tenants with no receipt, **and tenants whose most recent attempt is INVALID**, are counted as stale/unverified rather than silently excluded. This is a descriptive 24-hour freshness window, **not** a guaranteed enterprise coverage SLA: when many tenants exist, the batch cycle can legitimately exceed 24 hours.

## Security and operation

- The table is owned by each tenant through `tenantId` and deletes along with the tenant. It contains no employee event body, certificate, credential, or copy of the audit chain.
- A genuinely invalid chain remains an error and must not be fixed by rewriting prior ledger events. Alert/receipt writes are transactionally coupled.
- Transient database errors, maintenance HTTP 503, skipped scheduler intervals, and unsafe/missing verifier watermarks never imply successful verification. A missed run may leave a previously valid receipt unchanged until the next selected window.
- The scheduled scanner retains its previously reviewed 10,000-event budget and deterministic 15-minute rotation. No new full-chain worker, unsupported retry, or PII-bearing metric is introduced.
- Run schema migration checks before enabling the release in a customer environment. Production uses committed Prisma migration history, never `prisma db push`.

## Important limitations / remaining #215 work

The fixed time-slot rotation is still **best effort**; it has not been replaced with a durable tenant cursor or catch-up scheduler. A high tenant count or a changing tenant population can delay coverage. Persisted receipts make that gap measurable, but do not resolve it.

Receipts live in the same PostgreSQL trust domain as the audited data. They are **not independently signed checkpoints** or an immutable off-platform archive and cannot prove that a fully privileged database attacker did not rewrite both history and receipts. Full genesis-to-tail verification is a separate opt-in operator tool documented in `docs/maintenance-operations.md`. Independently signed checkpoints, continuous coverage/recovery logic, retention, and customer/SIEM trust anchors remain open under issue #215.

The P0 intermittent maintenance HTTP 503 root-cause investigation is separately tracked under issue #209.

## Acceptance evidence

The build gate checks schema parity and unit-tested first success, invalid ledger, invalid EMPTY ledger, stale tenant counts and preserved good watermarks. Disposable PostgreSQL integration verifies that successful receipts persist, failures survive a RED maintenance result, receipt and alert roll back together on a simulated notification failure, and subsequent success resets consecutive failures. None of these tests claims customer environment UAT has passed.
