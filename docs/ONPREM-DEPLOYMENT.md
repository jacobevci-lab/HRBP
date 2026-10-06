# HRBP One — On-prem deployment profile

This profile packages the application with PostgreSQL and private S3-compatible object storage for a single customer-controlled environment. It is the first productized on-prem profile; it does not remove tenant scoping or authorization controls from the application.

## Security defaults

- PostgreSQL and MinIO have no host-published ports.
- The application binds to `127.0.0.1:3000` by default so a customer reverse proxy/TLS gateway can terminate HTTPS.
- Local authentication is disabled in the production example. Configure enterprise OIDC before exposing the service.
- Required database, storage, session and service secrets must be supplied through `.env.onprem`, which is ignored by Git and excluded from the Docker build context.
- The object bucket is created as private. The application uses a dedicated MinIO service user scoped to GetObject/PutObject on that bucket; MinIO root credentials remain bootstrap/admin-only.
- Runtime containers use an unprivileged Node user.
- The schema service never uses Prisma's destructive `--accept-data-loss` option.

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

The `schema` one-shot service runs `prisma db push` only after PostgreSQL is healthy. A destructive schema change causes that step to stop instead of being accepted automatically. The application starts only after the schema job succeeds.

## Upgrade procedure

Before every upgrade:

1. Take a PostgreSQL backup and a storage backup/snapshot.
2. Record the running application revision from `/api/health/runtime`.
3. Pull/check out the approved release.
4. Rebuild and start the stack with the same command used for installation.
5. If the schema service reports a destructive change, stop the upgrade and use a vendor-reviewed migration plan. Do not force the schema.
6. Verify health, OIDC login, Action Center, document access and the customer's critical HR workflows before reopening access.

The repository currently has no committed Prisma migration history; therefore `db push` is an interim bootstrap mechanism, not the final enterprise upgrade strategy. Versioned migrations plus tested rollback/restore procedures remain a release-readiness requirement.

## Backup and recovery

PostgreSQL is the system of record. MinIO stores private document objects.

Example logical database backup:

```bash
docker compose --env-file .env.onprem -f docker-compose.onprem.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > hrbp-postgres.dump
```

Back up the `minio_data` volume with the customer's approved storage/backup tooling. A restore rehearsal should be part of pilot acceptance.

## Operational limits of this first profile

- It is a single-host Compose profile, not a high-availability cluster.
- TLS termination, enterprise secrets management, KMS/BYOK, centralized logging and external monitoring belong to the customer deployment architecture.
- MinIO image variables are overrideable; regulated deployments should pin vendor-approved immutable tags/digests.
- Scheduled maintenance endpoints/jobs still need an operations runbook or external scheduler appropriate to the target environment.
- Cloudflare remains a separate hosted deployment path; successful on-prem packaging does not imply the existing Cloudflare production build issue is resolved.
