# HRBP One — On-prem deployment profile

This profile packages HRBP One with PostgreSQL and a private S3-compatible object store for a single customer-controlled environment. It is the first productized on-prem profile; it does not remove tenant scoping or authorization controls from the application.

The bundled single-node object-store implementation is SeaweedFS. SeaweedFS is Apache-2.0 licensed and its current upstream documentation explicitly supports single-node `weed mini` as an S3-compatible deployment. HRBP One keeps the application contract provider-neutral through the existing `OBJECT_STORAGE_*` settings. Recovery copies are moved through pinned rclone tooling rather than a vendor-specific administration client.

## Security defaults

- PostgreSQL and the embedded object store have no host-published ports.
- The application binds to `127.0.0.1:3000` by default so a customer reverse proxy/TLS gateway can terminate HTTPS.
- Local authentication is disabled in the production example. Configure enterprise OIDC before exposing the service.
- Required database, storage, session and service secrets must be supplied through `.env.onprem`, which is ignored by Git and excluded from the Docker build context.
- The embedded S3 endpoint is reachable only on the private Compose network. Its access key/secret are mandatory and the bucket is bootstrapped by the storage service.
- The SeaweedFS image and rclone recovery image use explicit reviewed version tags. Mutable `latest` tags are rejected by the on-prem validator.
- SeaweedFS mini uses an explicit admin port below the Linux ephemeral range to avoid the upstream default admin-gRPC port collision class.
- Runtime application containers use an unprivileged Node user, `no-new-privileges`, and dropped Linux capabilities.
- The schema service never uses Prisma's destructive `--accept-data-loss` option.
- Backup artifacts are created with owner-only permissions, checksums, and an incomplete-backup marker that blocks restore.

## First installation

1. Install Docker Engine with the Compose plugin.
2. Copy the example, restrict the secret file, and replace every `CHANGE_ME` value:
   ```bash
   cp .env.onprem.example .env.onprem
   chmod 600 .env.onprem
   openssl rand -hex 48
   ```
3. Set `APP_URL`, OIDC issuer/client/redirect values, the customer tenant identifier, bootstrap administrator email and a strong object-storage secret.
4. Run the install preflight. It validates secret-file permissions, placeholder/secret hygiene, OIDC URL consistency, pinned images, Docker/Compose availability, Compose configuration and basic disk headroom without printing secret values:
   ```bash
   npm run onprem:preflight
   ```
5. Start the stack:
   ```bash
   docker compose --env-file .env.onprem -f docker-compose.onprem.yml up -d --build
   ```
6. Verify the complete local runtime rather than liveness only:
   ```bash
   npm run onprem:postflight
   docker compose --env-file .env.onprem -f docker-compose.onprem.yml ps
   ```
   Postflight waits for application runtime, PostgreSQL connectivity, configured authentication, notification-provider readiness, the authenticated operational-metrics surface, private object storage, clean Prisma migration status, a healthy document scanner and a healthy maintenance scheduler.
7. Place the service behind the customer's HTTPS reverse proxy and restrict direct access to port 3000.

The `schema` one-shot service runs the guarded versioned migration runner only after PostgreSQL is healthy. Fresh databases are created with committed `prisma migrate deploy` history. Existing installations from the pre-migration releases are never marked automatically unless their live PostgreSQL schema exactly matches the committed Prisma datamodel. The application starts only after the schema job and object-store health check succeed.

## Versioned database migrations

The first committed migration is `20261007000000_baseline_current_schema`. It represents the exact schema that existed before migration history was introduced.

The schema runner handles three cases:

- **Fresh install:** no application tables exist, so `prisma migrate deploy` applies the committed baseline and every later migration.
- **Already versioned install:** `_prisma_migrations` exists, so only pending committed migrations are deployed.
- **Legacy pre-migration install:** application tables exist but `_prisma_migrations` does not. The runner first executes a Prisma schema diff against the live database. Only an empty diff allows baseline adoption via `prisma migrate resolve --applied 20261007000000_baseline_current_schema`; pending migrations are then deployed.

If a legacy database differs from the committed datamodel, baseline adoption fails closed and no migration marker is written. The deployment must remain stopped until the difference is reviewed and an explicit vendor migration plan is prepared.

Production installation and upgrade procedures must not use `prisma db push`. That command remains available only for disposable development/test fixtures. Every production schema change after this baseline requires a reviewed migration directory committed under `prisma/migrations/`.

CI independently verifies that the migration history can create an empty database, that migration history and the current Prisma datamodel have zero drift, that an exact legacy schema can be safely baselined, and that a deliberately drifted legacy schema is rejected without writing migration history.

## Object storage

The bundled profile uses:

- `chrislusf/seaweedfs:4.48` for the private S3-compatible store,
- `rclone/rclone:1.75.1` only for backup/restore tooling,
- the existing application `OBJECT_STORAGE_ENDPOINT`, access-key, secret-key, bucket and region contract.

The storage service is intentionally not exposed on a host port. Customer deployments that later use an approved external S3-compatible platform should retain the same application-level storage contract; external-storage lifecycle/HA support is a separate deployment profile and is not silently implied by this single-host bundle.

The embedded credential currently controls the private application bucket and recovery tooling. It must be treated as a high-value service secret. A future external-storage profile should use the customer's native bucket/IAM policy to reduce privileges to the exact HRBP object operations.

## Document malware scanner

The on-prem profile includes a private, asynchronous document scanner. Uploaded document versions remain `PENDING` and unavailable for download until the scanner records a `CLEAN` verdict. Malware detections move the version to `QUARANTINED`; scanner failures remain blocked as `FAILED`.

Neither the scanner worker nor the maintenance scheduler inherits the full application secret file. Compose passes only the small set of runtime variables each sidecar needs; database, object-storage, OIDC and unrelated application secrets remain outside those containers.

The scanner is split into two private services:

- `document-scanner-engine` runs the pinned official `clamav/clamav:1.5.4-debian` image and persists signature databases in the `clamav_db` volume.
- `document-scanner` is an unprivileged, read-only HRBP worker. It has no object-storage credentials. It claims work from the authenticated internal scan endpoint and downloads only the object attached to its active claim through the application proxy.

ClamD TCP port 3310 is available only on the internal Compose network and is never published to the host. The worker submits bytes through ClamD `INSTREAM`; the engine therefore does not need access to the HRBP object-storage volume or credentials.

The queue uses durable database state:

`PENDING → SCANNING → CLEAN | QUARANTINED | FAILED`

Claims increment a bounded attempt counter and carry a database lock timestamp. Every download, release and worker completion is bound to that exact claim attempt, so a stale worker from an earlier lease cannot finalize or release a newer scanner claim. A worker crash normally returns a stale `SCANNING` claim to `PENDING`; if the stale lease already consumed the final allowed attempt, it is finalized as `FAILED` with audit evidence instead of becoming an unclaimable `PENDING` record. Transient object/engine failures use exponential retry and become `FAILED` only after the configured attempt budget is exhausted. Final callback processing is conditional and idempotent so an older/replayed result cannot overwrite a different final verdict.

Before bytes reach ClamAV, the worker verifies the downloaded object against the SHA-256 hash and size recorded with the immutable document version. A mismatch is immediately `QUARANTINED` by the HRBP integrity gate rather than retried or treated as clean.

Relevant controls:

```dotenv
HRBP_DOCUMENT_SCAN_POLL_SECONDS=10
HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS=5
HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS=30
HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS=600
HRBP_DOCUMENT_SCAN_LOCK_MINUTES=15
HRBP_DOCUMENT_SCAN_REQUEST_TIMEOUT_MS=30000
HRBP_DOCUMENT_SCAN_MAX_BYTES=26214400
HRBP_CLAMD_TIMEOUT_MS=30000
DOCUMENT_SCANNER_IMAGE=clamav/clamav:1.5.4-debian
```

`HRBP_DOCUMENT_SCAN_MAX_BYTES` must be at least `DOCUMENT_UPLOAD_MAX_BYTES`; otherwise the deployment preflight fails. The ClamAV team recommends substantial memory for the standard signature set, so customer sizing must reserve dedicated scanner capacity instead of assuming the engine is a lightweight sidecar. Signature updates require outbound access to the ClamAV update infrastructure unless the customer provides an approved internal mirror.

A scanner outage is fail-closed: documents remain unavailable until a clean verdict is recorded. Do not bypass `PENDING`, `SCANNING`, `FAILED` or `QUARANTINED` states to restore document availability.

## Private operational metrics

The application exposes a Prometheus-compatible operational snapshot at `/api/internal/metrics`. The endpoint is intentionally separate from public health checks and requires the dedicated `HRBP_METRICS_TOKEN` bearer credential.

The metrics surface is aggregation-only. It does not publish tenant IDs, user IDs, employee data, resource IDs, notification event names, document names, object keys or scanner references. Notification channels are collapsed to `IN_APP`, `EMAIL` and `OTHER`; document scanning is exposed only as queue/status counts and bounded age gauges.

Example local scrape:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $HRBP_METRICS_TOKEN" \
  http://127.0.0.1:${HRBP_HTTP_PORT:-3000}/api/internal/metrics
```

The current snapshot includes:

- notification outbox counts by bounded channel/status, due-job count, oldest actionable age and oldest dispatcher-lock age,
- document malware-scan counts by state, due-job count, oldest pending age and oldest scanner-lock age,
- SCIM-managed identity counts plus enabled/configured/rotation/adoption posture gauges,
- scrape health and collection duration.

Keep the endpoint on the private management path. Do not publish it through the customer-facing reverse proxy. A remote Prometheus/monitoring collector should reach it only through the customer's approved private management network or an authenticated monitoring proxy. `HRBP_METRICS_TOKEN` must not be reused as the maintenance, scanner, session, object-storage, database, OIDC or SMTP secret; install/upgrade preflight enforces this separation.

Postflight performs an authenticated scrape and fails deployment verification when the metrics endpoint is unavailable or does not expose the expected bounded metric families. Container health remains the liveness source for the maintenance scheduler and document-scanner sidecars; the application metrics endpoint complements rather than replaces those checks.

## SCIM 2.0 user provisioning

HRBP can expose a tenant-scoped SCIM 2.0 user provisioning surface for enterprise identity providers. It is disabled by default and is independent from interactive OIDC sign-in.

Enable it only after creating a dedicated random bearer credential:

```dotenv
HRBP_SCIM_ENABLED=true
HRBP_SCIM_TOKEN=<32-plus-character-random-secret>
# Optional temporary overlap during credential rotation:
HRBP_SCIM_TOKEN_PREVIOUS=
HRBP_SCIM_ALLOW_UNMANAGED_ADOPTION=false
```

The SCIM bearer token is a privileged service credential. It must not be reused as the session, maintenance, metrics, malware-scanner, database, object-storage, OIDC or SMTP secret. The install/upgrade preflight enforces minimum length, whitespace rejection and privileged-secret separation. For zero-downtime rotation, place the retiring credential temporarily in `HRBP_SCIM_TOKEN_PREVIOUS`, move the identity provider to `HRBP_SCIM_TOKEN`, verify provisioning, then remove the previous token. The two values must be distinct; postflight and the secret-free health endpoint expose only whether an overlap window is active.

The current release supports the SCIM `User` resource with bounded `userName`, `displayName`, `externalId` and `active` attributes, plus `GET/POST /Users`, `GET/PUT/PATCH/DELETE /Users/{id}`, ServiceProviderConfig, Schemas and ResourceTypes discovery. Group provisioning and bulk operations are explicitly unsupported. SCIM cannot assign HRBP roles: newly provisioned accounts are always created as `EMPLOYEE`.

All SCIM resources are scoped to `HRBP_AUTH_TENANT_ID` and to the configured allowed email domains. Mutating operations are serialized per tenant so concurrent identity-provider retries converge instead of creating a provisioning fork. Deactivation and DELETE are soft deprovisioning operations: the account is disabled and its application session version is advanced so previously issued HRBP sessions stop working on their next verified request.

By default SCIM will not take ownership of an existing unmanaged account. This prevents a provisioning connector from silently adopting a local or privileged administrator identity. A reviewed migration may set `HRBP_SCIM_ALLOW_UNMANAGED_ADOPTION=true`, but even then only non-local `EMPLOYEE` accounts can be adopted; privileged and local-auth accounts remain protected. Treat unmanaged-account adoption as a temporary migration control and disable it after convergence.

SCIM lifecycle changes produce append-only audit evidence using the system actor `system:scim-provisioner`. The health endpoint `/api/health/scim` exposes only enabled/configured/readiness state and never the bearer token. Post-deploy verification checks this endpoint; pre-upgrade verification remains compatible with releases that predate SCIM health.

## Optional SMTP email delivery

The on-prem Node runtime can deliver selected outbox events through an authenticated SMTP relay. SMTP is disabled by default and must pass the normal install/upgrade preflight before production use.

Minimum configuration:

```dotenv
HRBP_SMTP_ENABLED=true
HRBP_NOTIFICATION_EMAIL_EVENTS=LOCAL_AUTH_ACCOUNT_LOCKED,HR_SERVICE_ESCALATED
HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED=false
HRBP_NOTIFICATION_EMAIL_BATCH_SIZE=10
HRBP_SMTP_HOST=smtp.customer.internal
HRBP_SMTP_PORT=587
HRBP_SMTP_SECURE=false
HRBP_SMTP_USERNAME=hrbp-smtp
HRBP_SMTP_PASSWORD=<customer-secret>
HRBP_SMTP_FROM=HRBP <hrbp@customer.example>
```

Port 465 can be used with `HRBP_SMTP_SECURE=true`. Other ports use mandatory STARTTLS. TLS certificate verification cannot be disabled and the provider requires TLS 1.2 or newer.

Only events named in `HRBP_NOTIFICATION_EMAIL_EVENTS` are mirrored. `HIGHLY_RESTRICTED` events are never emailed. `RESTRICTED` events require the separate explicit restricted-email flag and their SMTP content is minimized to a generic secure-notification subject/body with a link back to HRBP.

The in-app notification and the email copy remain separate outbox records. A failed email therefore does not roll back or erase the in-app notification. SMTP work uses a small independent batch and normal retry/dead-letter governance.

Customer monitoring should alert on EMAIL records in `FAILED` or `DEAD_LETTER`. The Settings & Operations notification console exposes channel/status diagnostics without projecting employee payload content or SMTP credentials.

After deployment, a tenant settings administrator can use **Send test email** to exercise the real SMTP path to their own account email. The endpoint cannot be used as an arbitrary mail relay, records requested/succeeded/failed audit evidence, and permits at most one verification request per actor per minute.

## On-prem operational maintenance scheduler

The Compose profile includes a dedicated `maintenance-scheduler` sidecar. It is built from a minimal Node stage, runs as the unprivileged Node user, has a read-only root filesystem, drops Linux capabilities, publishes no host port, and can reach the maintenance API only through the private Compose service name `app:3000`.

The default cadence is 15 minutes:

```dotenv
HRBP_MAINTENANCE_INTERVAL_SECONDS=900
```

The value is bounded to 300–86400 seconds. Each cycle performs an authenticated protocol preflight and then invokes the eleven maintenance domains one at a time. Jobs are never run concurrently and maintenance POST requests are never automatically retried inside a cycle.

The scheduler stores only bounded operational evidence in the `scheduler_state` volume:

- `heartbeat.json` — process/cadence liveness,
- `last-run.json` — job/status/HTTP/duration diagnostic fields only,
- `blocked.json` — a durable safety latch when a POST outcome is ambiguous.

Arbitrary upstream response bodies, employee data, SQL text and the maintenance token are not written to scheduler state.

### Ambiguous outcome latch

If a write times out or returns an unverifiable response after the maintenance POST may have committed, the scheduler **stops automatic maintenance**. The block survives container restarts. This prevents a restart loop or the next scheduled cycle from blindly replaying a potentially committed job.

Inspect the scheduler state:

```bash
docker compose --env-file .env.onprem -f docker-compose.onprem.yml \
  run --rm --no-deps maintenance-scheduler \
  node scripts/onprem-maintenance-control.mjs status
```

After the affected domain has been independently checked, explicitly remove the latch:

```bash
docker compose --env-file .env.onprem -f docker-compose.onprem.yml \
  run --rm --no-deps maintenance-scheduler \
  node scripts/onprem-maintenance-control.mjs resume --acknowledge-unknown
```

The running scheduler rechecks the latch within one minute. Do not acknowledge an unknown outcome merely to make the container healthy.

Known domain failures do not create the ambiguous-outcome latch because the endpoint has verified the failed result. They still make the scheduler health check fail and are retried only by the next normal scheduled cycle. A later fully successful cycle returns the scheduler to healthy state.

`docker compose ... ps` should show both `app` and `maintenance-scheduler` healthy during normal operation. Central monitoring should alert on an unhealthy scheduler and on repeated maintenance job failures.

## Backup

Use the product backup command instead of ad-hoc volume copying:

```bash
bash scripts/onprem-backup.sh
```

An optional first argument selects a backup root:

```bash
bash scripts/onprem-backup.sh /srv/hrbp-backups
```

Each backup contains:

- a PostgreSQL custom-format logical dump,
- an exact local mirror of the configured S3 bucket,
- runtime health/revision evidence when the application is reachable,
- the recorded Prisma migration history (or an explicit legacy/no-history marker),
- bounded maintenance scheduler status/latch evidence,
- Docker image metadata,
- a small format manifest,
- SHA-256 checksums for the database, metadata, and every mirrored object.

The command creates `.incomplete` before any data is copied and removes it only after checksums are written. `migration-history.json` and `scheduler-status.json` are included in the checksum set so restore/release investigations can correlate a backup with both database migration state and maintenance scheduler state at capture time. The restore path refuses a backup carrying that marker. Backup directories are created with restrictive permissions and the default local `backups/` path is Git-ignored.

Backups must still be copied to customer-approved protected storage with retention, encryption, access control, monitoring, and off-host/off-site policy appropriate to the deployment.

## Restore

Restore is intentionally destructive and requires an explicit erase acknowledgement:

```bash
bash scripts/onprem-restore.sh /srv/hrbp-backups/hrbp-YYYYMMDDTHHMMSSZ --confirm-erase
```

The restore flow:

1. verifies `SHA256SUMS` before changing live state,
2. rejects incomplete backups and object symlinks,
3. stops the document scanner, maintenance scheduler and application/schema mutation surfaces,
4. starts only the database and private object-store recovery dependencies,
5. recreates the configured non-system PostgreSQL database and restores the logical dump,
6. synchronizes the backed-up S3 object set back to the bucket and deletes objects created after the backup,
7. restores any backed-up ambiguous-outcome maintenance latch into the durable scheduler state volume,
8. leaves the application, document scanner and maintenance scheduler stopped.

The application, document scanner and maintenance scheduler remain stopped after restore by design. If the backup recorded an ambiguous maintenance outcome, the restored scheduler latch remains blocked even on a new recovery host; inspect the affected domain before explicitly acknowledging/resuming it. Restore is monotonic for this safety state: an older backup that was unblocked never clears a newer existing unknown-outcome latch, because external side effects may not be reversed by database/object restore. Before reopening service, check out the application release corresponding to `runtime-health.json` / `images.json`, review schema compatibility, start the stack, then verify runtime health, OIDC sign-in, Action Center, document access, and customer-critical HR workflows. Do not use restore as a substitute for a reviewed database migration.

## Automated recovery rehearsal

The repository includes an isolated destructive recovery rehearsal:

```bash
npm run onprem:recovery:rehearsal
```

The rehearsal creates a dedicated `hrbp-recovery-*` Compose project and disposable `hrbp_recovery` database. It starts the same bundled S3 service used by the product profile, seeds database and object markers, takes a real backup, mutates both stores, restores the backup, and verifies that:

- backed-up database state returns,
- post-backup database objects disappear,
- backed-up S3 content returns,
- post-backup S3 objects disappear.

The rehearsal never targets the normal `hrbp-one` Compose project and tears down its isolated volumes at the end. CI runs this recovery rehearsal as a release gate.

## Upgrade procedure

The approved release must be checked out **before** beginning the maintenance window. HRBP One intentionally does not run `git pull`, `git fetch` or automatic source checkout inside the upgrade command.

For the normal single-host profile, use the guarded upgrade command:

```bash
npm run onprem:upgrade -- --maintenance-window
```

The command requires explicit maintenance-window acknowledgement and performs the following sequence:

1. Runs the upgrade preflight with a clean tracked source-tree requirement.
2. Verifies the **currently running** application, database, authentication and scheduler before changing anything; this pre-upgrade probe deliberately does not compare the target migration history yet.
3. Resolves the exact 40-character Git target revision, exports it into the image build, and builds the target `schema`, `app` and `maintenance-scheduler` images **before downtime** so compile/package failures do not create an outage.
4. Stops the maintenance scheduler and application mutation surfaces.
5. Takes a quiesced PostgreSQL + object-store backup and preserves migration/scheduler evidence.
6. Stores the bounded current-state probe as checksummed `pre-upgrade-health.json` and writes checksummed `upgrade-intent.json`.
7. Applies only committed Prisma migration history and waits for a verified schema-service exit code.
8. Starts the target application and scheduler.
9. Runs bounded postflight checks for runtime, **exact deployed release revision**, database, authentication, private S3 bucket access, clean migration state and scheduler health.
10. Writes a checksummed `upgrade-receipt.json` only after every postflight gate succeeds.

An example with explicit paths:

```bash
bash scripts/onprem-upgrade.sh --maintenance-window \
  --env-file /etc/hrbp/.env.onprem \
  --backup-root /srv/hrbp-backups
```

### Fail-closed upgrade behavior

The upgrade command never automatically executes a destructive restore. If a failure happens after the maintenance window begins, it leaves the deployment for operator inspection and prints the verified backup location when one exists.

Do not respond to a failed migration by forcing `migrate resolve`, falling back to `db push`, or starting an older application binary against a potentially newer schema. Inspect the schema container logs and:

- use a reviewed forward migration when the database state is valid but the release needs correction, or
- check out the release recorded in the backup evidence and use the guarded restore procedure when restore is the safer recovery path.

The preflight also rejects a dirty tracked source tree for upgrades. This prevents local edits from becoming an unrecorded customer release.

### Manual verification commands

Operators can run the gates independently:

```bash
node scripts/onprem-preflight.mjs --env-file .env.onprem --phase upgrade --require-clean-source
node scripts/onprem-postflight.mjs --env-file .env.onprem --mode pre-upgrade --timeout-seconds 120
node scripts/onprem-postflight.mjs --env-file .env.onprem --mode post-deploy --timeout-seconds 600 --expected-revision <40-char-approved-sha>
npm run db:migrate:status
```

Postflight talks only to the host-local application port, verifies the configured private S3 bucket through the provider-neutral recovery client, and uses bounded responses. Object names are not emitted as operator output. It does not print authentication secrets, database URLs or upstream error bodies.

Versioned migrations remain the production schema contract. The guarded legacy-baseline path exists only to bring installations created before migration history into that contract. Recovery tooling remains the rollback safety boundary for data-changing upgrades; migration history is forward-only and does not replace backup/restore discipline.

## Operational limits of this profile

- It is a single-host Compose profile, not a high-availability cluster.
- TLS termination, enterprise secrets management, KMS/BYOK, centralized logging and external monitoring belong to the customer deployment architecture.
- The bundled SeaweedFS profile is intentionally single-node. Customers requiring storage HA, erasure coding, managed support or a mandated S3 platform should use a separately validated storage architecture rather than interpreting this profile as an HA object-storage design.
- The bundled maintenance scheduler is single-host. Customers replacing it with an enterprise scheduler must preserve the authenticated single-job protocol, serialization and no-blind-retry rules.
- Backup RPO/RTO, retention, immutable/off-site copies and restore cadence must be agreed with each customer; the product rehearsal proves mechanics, not the customer's full disaster-recovery program.
- Cloudflare remains a separate hosted deployment path; successful on-prem packaging does not imply the existing Cloudflare production deployment path is healthy.
