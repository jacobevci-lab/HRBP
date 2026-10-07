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
2. Copy the example and replace every `CHANGE_ME` value:
   ```bash
   cp .env.onprem.example .env.onprem
   openssl rand -hex 48
   ```
3. Set `APP_URL`, OIDC issuer/client/redirect values, the customer tenant identifier, bootstrap administrator email and a strong object-storage secret.
4. Start the stack:
   ```bash
   docker compose --env-file .env.onprem -f docker-compose.onprem.yml up -d --build
   ```
5. Verify:
   ```bash
   docker compose --env-file .env.onprem -f docker-compose.onprem.yml ps
   curl --fail http://127.0.0.1:3000/api/health/runtime
   ```
6. Place the service behind the customer's HTTPS reverse proxy and restrict direct access to port 3000.

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
- Docker image metadata,
- a small format manifest,
- SHA-256 checksums for the database, metadata, and every mirrored object.

The command creates `.incomplete` before any data is copied and removes it only after checksums are written. The restore path refuses a backup carrying that marker. Backup directories are created with restrictive permissions and the default local `backups/` path is Git-ignored.

Backups must still be copied to customer-approved protected storage with retention, encryption, access control, monitoring, and off-host/off-site policy appropriate to the deployment.

## Restore

Restore is intentionally destructive and requires an explicit erase acknowledgement:

```bash
bash scripts/onprem-restore.sh /srv/hrbp-backups/hrbp-YYYYMMDDTHHMMSSZ --confirm-erase
```

The restore flow:

1. verifies `SHA256SUMS` before changing live state,
2. rejects incomplete backups and object symlinks,
3. stops the application/schema mutation surfaces,
4. starts only the database and private object-store recovery dependencies,
5. recreates the configured non-system PostgreSQL database and restores the logical dump,
6. synchronizes the backed-up S3 object set back to the bucket and deletes objects created after the backup,
7. leaves the application stopped.

The application remains stopped after restore by design. Before reopening service, check out the application release corresponding to `runtime-health.json` / `images.json`, review schema compatibility, start the stack, then verify runtime health, OIDC sign-in, Action Center, document access, and customer-critical HR workflows. Do not use restore as a substitute for a reviewed database migration.

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

Before every upgrade:

1. Run `bash scripts/onprem-backup.sh <approved-backup-root>`.
2. Copy the completed backup to the customer's protected backup target and verify retention.
3. Record/retain the running application revision from the backup metadata.
4. Pull/check out the approved release.
5. Review the release's committed Prisma migration directories and approved change notes.
6. Rebuild and start the stack with the same command used for installation. The schema service runs only committed migrations.
7. If migration deployment or legacy parity verification fails, keep the application closed and use a vendor-reviewed migration/restore plan. Do not force or bypass the migration state.
8. Verify health, OIDC login, Action Center, document access and the customer's critical HR workflows before reopening access.

If rollback requires a data restore, first check out the release recorded with the backup, then use the guarded restore procedure above. Starting a newer binary against an older restored database is not an approved rollback path.

Versioned migrations are now the production schema contract. The guarded baseline adoption path exists only to bring installations created before this migration history into that contract. Recovery tooling remains the rollback safety boundary for data-changing upgrades; migration history is forward-only and does not replace backup/restore discipline.

## Operational limits of this profile

- It is a single-host Compose profile, not a high-availability cluster.
- TLS termination, enterprise secrets management, KMS/BYOK, centralized logging and external monitoring belong to the customer deployment architecture.
- The bundled SeaweedFS profile is intentionally single-node. Customers requiring storage HA, erasure coding, managed support or a mandated S3 platform should use a separately validated storage architecture rather than interpreting this profile as an HA object-storage design.
- Scheduled maintenance endpoints/jobs still need an operations runbook or external scheduler appropriate to the target environment.
- Backup RPO/RTO, retention, immutable/off-site copies and restore cadence must be agreed with each customer; the product rehearsal proves mechanics, not the customer's full disaster-recovery program.
- Cloudflare remains a separate hosted deployment path; successful on-prem packaging does not imply the existing Cloudflare production deployment path is healthy.
