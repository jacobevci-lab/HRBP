# Operations automation

## Document malware scanning

Document versions are immutable and follow this lifecycle:

1. `POST /api/documents/{documentId}/versions` reserves a version with a SHA-256 hash and `PENDING` scan state.
2. `PUT /api/documents/{documentId}/versions/{versionId}/upload` proxies the binary into private S3/MinIO-compatible storage after authorization, MIME/size checks and server-side SHA-256 verification.
3. The scanner reads the private object out-of-band and reports the result to `POST /api/internal/document-scan` with `Authorization: Bearer $HRBP_DOCUMENT_SCAN_TOKEN`.
4. Only a latest version in `CLEAN` state can be downloaded. `PENDING`, `FAILED` and `QUARANTINED` versions stay blocked.

Example scanner callback body:

```json
{
  "versionId": "document-version-id",
  "status": "CLEAN",
  "engine": "scanner-name",
  "reference": "scan-job-123",
  "message": "No malware detected"
}
```

The callback token should be a long random secret stored in the deployment secret manager, never in source control.

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

`NotificationOutbox` stores delivery intent independently from a future email, in-app, Teams/Slack, webhook or other channel adapter. Current maintenance events include:

- `HR_SERVICE_ESCALATED` → current or newly auto-routed assignee when available;
- `POLICY_EXCEPTION_EXPIRED` → exception requestor;
- `POLICY_EXCEPTION_CLOSED_ON_RETIREMENT` → exception requestor;
- `POLICY_RETIRED` → policy owner.

Outbox records start in `PENDING` and include channel, optional recipient, template key, resource reference, classification, retry metadata and a JSON payload. Delivery workers should claim eligible `PENDING` records, move them through `PROCESSING`, and finish them as `DELIVERED`, `FAILED` or `DEAD_LETTER` with retry/backoff controls. The current bulk intentionally separates durable event creation from provider-specific delivery so SMTP/webhook failures cannot roll back HR or policy state.

Relevant runtime settings are documented in `.env.example`:

- `HRBP_MAINTENANCE_TOKEN`
- `HRBP_DOCUMENT_SCAN_TOKEN`
- `DOCUMENT_UPLOAD_MAX_BYTES`
- `HRBP_SERVICE_SLA_WARNING_MINUTES`
- `HRBP_SERVICE_SLA_SEVERE_MINUTES`
- `HRBP_MAINTENANCE_BATCH_SIZE`
