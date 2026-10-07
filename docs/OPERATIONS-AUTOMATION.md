# Operations automation

## Document malware scanning

Document versions are immutable and follow a fail-closed lifecycle:

1. `POST /api/documents/{documentId}/versions` reserves a version with its SHA-256 hash and `PENDING` state.
2. `PUT /api/documents/{documentId}/versions/{versionId}/upload` writes the binary to private object storage only after authorization, MIME/size checks and server-side SHA-256 verification. Upload completion resets the durable scan queue for immediate work.
3. The authenticated scanner protocol at `POST /api/internal/document-scan` claims one eligible job at a time and conditionally moves it `PENDING → SCANNING`.
4. A claimed object can be downloaded only through the internal scan endpoint while the version is actively `SCANNING`. The worker therefore needs the scanner token but receives no object-storage credentials or object key.
5. The on-prem worker verifies the immutable size/hash, streams the bytes to private ClamD using the `INSTREAM` protocol and records `CLEAN`, `QUARANTINED` or `FAILED`.
6. Only a latest version in `CLEAN` state can be downloaded by users. `PENDING`, `SCANNING`, `FAILED` and `QUARANTINED` remain blocked.

The queue stores attempt count, lock timestamp and next-attempt time. A stale `SCANNING` lock is recovered to `PENDING`; transient scanner failures use bounded exponential retry. After the retry budget is exhausted the version becomes `FAILED` and remains unavailable. Final scan callbacks are conditional and idempotent: replaying the same final verdict is harmless, while a different later verdict cannot overwrite an already-final state.

The on-prem worker performs its own content-integrity verification before malware scanning. A mismatch between the claimed immutable metadata and the bytes returned from object storage is immediately `QUARANTINED` as `CONTENT_INTEGRITY_MISMATCH`.

ClamD runs on the private Compose network only. Port 3310 is not published to the host, and the worker has no direct S3 credential surface. Signature data persists in its own volume and is updated by the ClamAV image's normal signature-update process.

For compatibility, the internal endpoint still accepts a direct final scanner callback with `versionId`, `status`, `engine`, optional `reference` and optional bounded `message`; the same final-state concurrency rules apply.

The callback token is a long random secret stored in the deployment secret manager and is never committed to source control.

## Operational maintenance

`POST /api/internal/maintenance` requires `Authorization: Bearer $HRBP_MAINTENANCE_TOKEN` and performs idempotent maintenance work:

- raises HR Service escalation level when an SLA enters its warning window, breaches, or becomes severely overdue;
- auto-routes an unassigned breached request to the oldest OWNER of its active queue when one exists;
- expires approved policy exceptions after `expiresAt`;
- retires published policies after `effectiveTo` and closes dependent requested/approved exceptions;
- writes notification intent into the durable transactional outbox for every successful automated transition.

Every state transition is written to the tenant audit chain with a system actor. Notification intent is inserted in the same database transaction as the state transition. A tenant-scoped dedupe key prevents repeated scheduler executions from creating duplicate notifications.

### Scheduler

`.github/workflows/operational-maintenance.yml` invokes the internal endpoint every 15 minutes and also supports manual dispatch. Configure these GitHub repository secrets before enabling production scheduling:

- `HRBP_MAINTENANCE_URL`: full HTTPS endpoint ending in `/api/internal/maintenance`;
- `HRBP_MAINTENANCE_TOKEN`: the same minimum-24-character secret exposed to the application runtime as `HRBP_MAINTENANCE_TOKEN`.

A manually dispatched run fails when either secret is missing. Scheduled runs skip with a warning while configuration is incomplete, which prevents an unconfigured repository from producing recurring failed jobs. The workflow uses a single concurrency group so maintenance executions cannot overlap.

The endpoint remains scheduler-agnostic. A Cloudflare scheduled worker or enterprise job runner can replace the GitHub scheduler later without changing domain logic.

### Transactional notification outbox

`NotificationOutbox` stores delivery intent independently for in-app, SMTP email and future Teams/Slack, webhook or other channel adapters. Current maintenance events include:

- `HR_SERVICE_ESCALATED` → current or newly auto-routed assignee when available;
- `POLICY_EXCEPTION_EXPIRED` → exception requestor;
- `POLICY_EXCEPTION_CLOSED_ON_RETIREMENT` → exception requestor;
- `POLICY_RETIRED` → policy owner.

Outbox records start in `PENDING` and include channel, optional recipient, template key, resource reference, classification, retry metadata and a JSON payload. Delivery workers should claim eligible `PENDING` records, move them through `PROCESSING`, and finish them as `DELIVERED`, `FAILED` or `DEAD_LETTER` with retry/backoff controls. Durable event creation remains separate from provider-specific delivery so SMTP failures cannot roll back HR or policy state; SMTP is the first external adapter using that contract.

### SMTP email delivery

External email delivery is optional and disabled by default. When `HRBP_SMTP_ENABLED=true`, the transactional outbox can mirror explicitly allowlisted event types into independent `EMAIL` records. Email mirroring never replaces the in-app record; the two channels have separate dedupe keys, claims, retries and dead-letter state.

Required controls:

- `HRBP_NOTIFICATION_EMAIL_EVENTS` is an explicit event-type allowlist. Empty means no email mirroring.
- `HIGHLY_RESTRICTED` notifications are never mirrored to SMTP.
- `RESTRICTED` notifications require the additional `HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED=true` gate and use generic subject/body text plus a link to the secured application rather than sensitive payload details.
- SMTP uses either implicit TLS or mandatory STARTTLS. Certificate validation is always enabled and TLS 1.2+ is required.
- Provider errors are reduced to bounded machine diagnostics before being written to the outbox.
- Role recipients are fanned out into user-scoped `EMAIL` outbox records before delivery so one recipient failure does not hide the state of others.
- A stable outbox-derived Message-ID is reused across retries to reduce duplicate delivery risk when a transport outcome is ambiguous. SMTP remains an at-least-once channel; downstream mail infrastructure must tolerate duplicate Message-ID delivery.
- Email delivery has an independent bounded batch via `HRBP_NOTIFICATION_EMAIL_BATCH_SIZE` so SMTP latency cannot consume the entire in-app notification batch.

On-prem installation/upgrade preflight validates SMTP host, port, credentials, event allowlist, TLS-related names, timeout bounds and secret reuse whenever SMTP is enabled. The Settings & Operations page surfaces SMTP readiness without exposing provider credentials. A settings administrator can send a self-addressed verification email through the real SMTP provider; the target address is always the authenticated administrator's tenant-scoped account, the action/outcome is audited, and the verification endpoint is rate-limited to one request per minute per actor.

Cloudflare-hosted deployments must not assume raw SMTP socket delivery is available merely because the code can be bundled. Keep `HRBP_SMTP_ENABLED=false` there unless the runtime/provider path has been separately validated; a future HTTPS mail provider can implement the same `EMAIL` outbox contract without changing domain notification producers.

Relevant runtime settings are documented in `.env.example`:

- `HRBP_MAINTENANCE_TOKEN`
- `HRBP_DOCUMENT_SCAN_TOKEN`
- `DOCUMENT_UPLOAD_MAX_BYTES`
- `HRBP_DOCUMENT_SCAN_POLL_SECONDS`
- `HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS`
- `HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS`
- `HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS`
- `HRBP_DOCUMENT_SCAN_LOCK_MINUTES`
- `HRBP_DOCUMENT_SCAN_MAX_BYTES`
- `HRBP_CLAMD_TIMEOUT_MS`
- `HRBP_SERVICE_SLA_WARNING_MINUTES`
- `HRBP_SERVICE_SLA_SEVERE_MINUTES`
- `HRBP_MAINTENANCE_BATCH_SIZE`
- `HRBP_SMTP_ENABLED`
- `HRBP_NOTIFICATION_EMAIL_EVENTS`
- `HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED`
- `HRBP_NOTIFICATION_EMAIL_BATCH_SIZE`
- `HRBP_SMTP_HOST`
- `HRBP_SMTP_PORT`
- `HRBP_SMTP_USERNAME`
- `HRBP_SMTP_PASSWORD`
- `HRBP_SMTP_FROM`
