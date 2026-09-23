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
- retires published policies after `effectiveTo` and closes dependent requested/approved exceptions.

Recommended cadence is every 15 minutes. The endpoint is intentionally scheduler-agnostic so Cloudflare scheduled workers, a platform scheduler, or an external enterprise job runner can call it without embedding credentials in the application bundle.

Relevant runtime settings are documented in `.env.example`:

- `HRBP_MAINTENANCE_TOKEN`
- `HRBP_DOCUMENT_SCAN_TOKEN`
- `DOCUMENT_UPLOAD_MAX_BYTES`
- `HRBP_SERVICE_SLA_WARNING_MINUTES`
- `HRBP_SERVICE_SLA_SEVERE_MINUTES`
- `HRBP_MAINTENANCE_BATCH_SIZE`

Every state transition performed by these internal services is written to the tenant audit chain with a system actor.
