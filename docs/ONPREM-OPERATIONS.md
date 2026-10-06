# HRBP One On-Prem Deployment v1

This profile adds a customer-operated Node deployment without replacing the existing Cloudflare/OpenNext release path.

## Included in v1

- Node 22 standalone HRBP image.
- Non-root application process and read-only application filesystem.
- Private backend network for PostgreSQL, Redis and object storage.
- Separate PostgreSQL admin and runtime roles.
- Install-only schema bootstrap that refuses a non-empty database.
- Initial Tenant creation.
- Loopback application binding by default for customer TLS termination.
- Runtime health reporting that identifies `onprem-node`.
- Repository validation tests that run before every production build.

## Deliberate safety boundary

The current repository does not yet contain a reviewed versioned migration history for unattended customer upgrades. The `schema-bootstrap` image is therefore **first-install only**.

It checks the target PostgreSQL public schema before `prisma db push`. If any base table already exists, bootstrap exits instead of modifying it. Do not use `db push`, `--accept-data-loss`, or the bootstrap image to upgrade an installed customer database.

Database migration packages, backup/restore automation and tested upgrade/rollback are the next release-engineering phase.

## Deployment layout

The Compose profile keeps PostgreSQL, Redis and object storage on an internal network. Only the HRBP application publishes a host port, bound to `127.0.0.1:3000` by default. Put a customer-managed reverse proxy or load balancer with TLS in front of that address.

The application connects with the restricted `hrbp_app` database role. Schema bootstrap uses the separate database owner account.

## Build

Commercial releases should distribute prebuilt, versioned images. Repository validation can build both targets locally:

```bash
docker compose --env-file deploy/onprem/.env \
  -f deploy/onprem/compose.yml build schema-bootstrap app
```

Set `HRBP_SOURCE_REVISION` to the exact 40-hex release commit so `/api/health/runtime` exposes the release identity.

## First install

1. Copy `deploy/onprem/.env.example` to `deploy/onprem/.env`.
2. Replace all example credentials and configure the customer URL, tenant identity and OIDC settings.
3. Protect the file with operating-system permissions and keep it out of source control.
4. Start the data services.
5. Run the PostgreSQL runtime-role initializer on a fresh volume.
6. Run the install-only `schema-bootstrap` profile.
7. Create the private object-storage bucket and dedicated application service account.
8. Start the app and verify `/api/health/runtime`, `/api/health/db` and `/api/health/auth`.

The schema bootstrap creates the configured Tenant row. With OIDC, `HRBP_BOOTSTRAP_ADMIN_EMAIL` becomes the initial tenant administrator after the matching identity successfully signs in.

Local-account creation is intentionally not automated by this v1 commercial bootstrap. OIDC is the supported first-install path in this phase.

## Release limits before general availability

Before describing on-prem delivery as generally available, close these items:

- versioned database migrations and release compatibility rules;
- backup/restore automation with isolated restore drills;
- upgrade/rollback workflow and forward-fix policy;
- signed image and SBOM distribution;
- external secret-manager/file-secret integration;
- object-vault bootstrap automation;
- scheduled maintenance execution outside Cloudflare Cron;
- reference reverse-proxy/TLS configurations;
- observability/log shipping and retention defaults;
- customer acceptance tests for OIDC and external integrations;
- supported OS/container-runtime matrix and DR RPO/RTO evidence.

This v1 should be treated as the deployment foundation for controlled pilots, not a zero-touch production upgrader.
