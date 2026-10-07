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
   Postflight waits for application runtime, PostgreSQL connectivity, configured authentication, clean Prisma migration status and a healthy maintenance scheduler.
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
3. stops the maintenance scheduler plus application/schema mutation surfaces,
4. starts only the database and private object-store recovery dependencies,
5. recreates the configured non-system PostgreSQL database and restores the logical dump,
6. synchronizes the backed-up S3 object set back to the bucket and deletes objects created after the backup,
7. restores any backed-up ambiguous-outcome maintenance latch into the durable scheduler state volume,
8. leaves the application and maintenance scheduler stopped.

The application and maintenance scheduler remain stopped after restore by design. If the backup recorded an ambiguous maintenance outcome, the restored scheduler latch remains blocked even on a new recovery host; inspect the affected domain before explicitly acknowledging/resuming it. Restore is monotonic for this safety state: an older backup that was unblocked never clears a newer existing unknown-outcome latch, because external side effects may not be reversed by database/object restore. Before reopening service, check out the application release corresponding to `runtime-health.json` / `images.json`, review schema compatibility, start the stack, then verify runtime health, OIDC sign-in, Action Center, document access, and customer-critical HR workflows. Do not use restore as a substitute for a reviewed database migration.

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
3. Builds the target `schema`, `app` and `maintenance-scheduler` images **before downtime** so compile/package failures do not create an outage.
4. Stops the maintenance scheduler and application mutation surfaces.
5. Takes a quiesced PostgreSQL + object-store backup and preserves migration/scheduler evidence.
6. Stores the bounded current-state probe as checksummed `pre-upgrade-health.json` and writes checksummed `upgrade-intent.json`.
7. Applies only committed Prisma migration history and waits for a verified schema-service exit code.
8. Starts the target application and scheduler.
9. Runs bounded postflight checks for runtime, database, authentication, clean migration state and scheduler health.
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
node scripts/onprem-postflight.mjs --env-file .env.onprem --mode post-deploy --timeout-seconds 600
npm run db:migrate:status
```

Postflight talks only to the host-local application port and uses bounded responses. It does not print authentication secrets, database URLs or upstream error bodies.

Versioned migrations remain the production schema contract. The guarded legacy-baseline path exists only to bring installations created before migration history into that contract. Recovery tooling remains the rollback safety boundary for data-changing upgrades; migration history is forward-only and does not replace backup/restore discipline.

## Operational limits of this profile

- It is a single-host Compose profile, not a high-availability cluster.
- TLS termination, enterprise secrets management, KMS/BYOK, centralized logging and external monitoring belong to the customer deployment architecture.
- The bundled SeaweedFS profile is intentionally single-node. Customers requiring storage HA, erasure coding, managed support or a mandated S3 platform should use a separately validated storage architecture rather than interpreting this profile as an HA object-storage design.
- The bundled maintenance scheduler is single-host. Customers replacing it with an enterprise scheduler must preserve the authenticated single-job protocol, serialization and no-blind-retry rules.
- Backup RPO/RTO, retention, immutable/off-site copies and restore cadence must be agreed with each customer; the product rehearsal proves mechanics, not the customer's full disaster-recovery program.
- Cloudflare remains a separate hosted deployment path; successful on-prem packaging does not imply the existing Cloudflare production deployment path is healthy.
