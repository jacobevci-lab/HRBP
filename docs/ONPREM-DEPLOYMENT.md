# HRBP One — On-prem deployment profile

This profile packages the application with PostgreSQL and private S3-compatible object storage for a single customer-controlled environment. It is the first productized on-prem profile; it does not remove tenant scoping or authorization controls from the application.

## Security defaults

- PostgreSQL and MinIO have no host-published ports.
- The application binds to `127.0.0.1:3000` by default so a customer reverse proxy/TLS gateway can terminate HTTPS.
- Local authentication is disabled in the production example. Configure enterprise OIDC before exposing the service.
- Required database, storage, session and service secrets must be supplied through `.env.onprem`, which is ignored by Git and excluded from the Docker build context.
- The object bucket is created as private. The application uses a dedicated MinIO service user scoped to GetObject/PutObject on that bucket; MinIO root credentials remain bootstrap/admin-only.
- Runtime containers use an unprivileged Node user, `no-new-privileges`, and dropped Linux capabilities.
- The schema service never uses Prisma's destructive `--accept-data-loss` option.
- Backup artifacts are created with owner-only permissions, checksums, and an incomplete-backup marker that blocks restore.

## First installation

1. Install Docker Engine with the Compose plugin.
2. Copy the example and replace every `CHANGE_ME` value:
   ```bash
   cp .env.onprem.example .env.onprem
   openssl rand -hex 48
   ```
3. Set `APP_URL`, OIDC issuer/client/redirect values, the customer tenant identifier, bootstrap administrator email and distinct object-storage application credentials. Do not reuse the MinIO root credentials.
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

The `schema` one-shot service currently runs `prisma db push` only after PostgreSQL is healthy. A destructive schema change causes that step to stop instead of being accepted automatically. The application starts only after the schema job succeeds.

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
- a MinIO bucket mirror,
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
4. recreates the configured non-system PostgreSQL database and restores the logical dump,
5. mirrors the backed-up object set to MinIO and removes objects created after the backup,
6. leaves the application stopped.

The application remains stopped after restore by design. Before reopening service, check out the application release corresponding to `runtime-health.json` / `images.json`, review schema compatibility, start the stack, then verify runtime health, OIDC sign-in, Action Center, document access, and customer-critical HR workflows. Do not use restore as a substitute for a reviewed database migration.

## Automated recovery rehearsal

The repository includes an isolated destructive recovery rehearsal:

```bash
npm run onprem:recovery:rehearsal
```

The rehearsal creates a dedicated `hrbp-recovery-*` Compose project and disposable `hrbp_recovery` database, seeds database and object markers, takes a real backup, mutates both stores, restores the backup, and verifies that:

- backed-up database state returns,
- post-backup database objects disappear,
- backed-up MinIO content returns,
- post-backup MinIO objects disappear.

The rehearsal never targets the normal `hrbp-one` Compose project and tears down its isolated volumes at the end. CI runs this recovery rehearsal as a release gate.

## Upgrade procedure

Before every upgrade:

1. Run `bash scripts/onprem-backup.sh <approved-backup-root>`.
2. Copy the completed backup to the customer's protected backup target and verify retention.
3. Record/retain the running application revision from the backup metadata.
4. Pull/check out the approved release.
5. Rebuild and start the stack with the same command used for installation.
6. If the schema service reports a destructive change, stop the upgrade and use a vendor-reviewed migration plan. Do not force the schema.
7. Verify health, OIDC login, Action Center, document access and the customer's critical HR workflows before reopening access.

If rollback requires a data restore, first check out the release recorded with the backup, then use the guarded restore procedure above. Starting a newer binary against an older restored database is not an approved rollback path.

The repository currently has no committed Prisma migration history; therefore `db push` is an interim bootstrap mechanism, not the final enterprise upgrade strategy. **Versioned migrations** with baseline adoption and forward-tested upgrade paths remain the next release-readiness gate. The new recovery tooling provides the required safety net but does not make unversioned schema mutation an acceptable long-term upgrade model.

## Operational limits of this profile

- It is a single-host Compose profile, not a high-availability cluster.
- TLS termination, enterprise secrets management, KMS/BYOK, centralized logging and external monitoring belong to the customer deployment architecture.
- The bundled object-store defaults use pinned historical MinIO Community images from Quay because the old Docker Hub repositories are no longer a reliable fresh-install source. For a commercial customer deployment, review MinIO/AGPL support and redistribution obligations and override these images with the customer's approved/licensed S3-compatible distribution where required.
- Scheduled maintenance endpoints/jobs still need an operations runbook or external scheduler appropriate to the target environment.
- Backup RPO/RTO, retention, immutable/off-site copies and restore cadence must be agreed with each customer; the product rehearsal proves mechanics, not the customer's full disaster-recovery program.
- Cloudflare remains a separate hosted deployment path; successful on-prem packaging does not imply the existing Cloudflare production build issue is resolved.
