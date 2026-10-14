# Operational maintenance: safe 503 correlation

This runbook supports investigation of intermittent maintenance HTTP 503 responses, including P0 issue #209. It does **not** diagnose their root cause by itself.

## Available telemetry

When the maintenance endpoint responds with HTTP 503 and its Cloudflare edge supplies a valid `CF-Ray` header, the external maintenance runner adds only that allowlisted identifier to the bounded per-job failure record and GitHub Actions summary. The identifier must match 16–32 lowercase hexadecimal characters, a hyphen and a three-letter uppercase edge code. Invalid, missing, control-character, arbitrary `x-request-id` or other provider headers are never printed or copied to results. The result still contains only job name, HTTP status, diagnostic, wall-clock duration and, when present, the approved `cfRay`.

A valid-looking CF-Ray identifier is **not** cryptographic proof that Cloudflare generated it. Its purpose is best-effort correlation with authorized platform logs.

## Operator investigation

1. Record UTC date/time, GitHub workflow run ID, selected job, returned HTTP code and optional allowlisted CF-Ray. Use only approved restricted incident notes.
2. Correlate CF-Ray and timestamp against Cloudflare Worker/edge request logs, request duration, CPU/memory alarms, runtime exceptions, deployments and rate limiting. Investigate absent CF-Ray as a separate outcome; do not invent it.
3. Check PostgreSQL connection availability and query latency in the same time window. Compare audit-integrity ledger checks, tenant selection and notification outbox for the affected run.
4. An unclassified 503 remains `HTTP_503_UNCLASSIFIED_STOPPED`: the maintenance runner stops subsequent writes and **never retries the POST automatically**. A confirmed Cloudflare error 1102 keeps `WORKER_RESOURCE_LIMIT_1102` and can allow later selected jobs to proceed, but the run remains failed.
5. Determine whether the handler executed, whether any domain transaction committed and which job is safe to rerun before manually triggering only that job. Do not replay `all` merely to turn CI green.

Never copy raw response bodies, bearer tokens, database URLs, employee information, SQL details or unfiltered HTTP response headers into GitHub logs or ticket comments.

A successfully collected ray identifier does not resolve issue #209, certify Cloudflare resource limits, or replace production incident traces. It also does not prove the audit ledger is intact. The root-cause issue must remain open until separately verified by operations.
