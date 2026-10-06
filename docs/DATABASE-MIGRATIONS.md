# HRBP One — Versioned database migration policy

HRBP One uses PostgreSQL and Prisma. Customer/on-prem releases must evolve database schema through committed, reviewable Prisma migrations rather than unversioned `prisma db push`.

## Migration history

The repository migration history begins with:

```
prisma/migrations/
  0_baseline/
    migration.sql
  migration_lock.toml
```

`0_baseline` represents the complete Prisma schema at the point versioned migrations were introduced. It is generated from the full multi-file `./prisma` schema and is never hand-replayed against an existing HRBP database.

Every later schema change must add a new migration after `0_baseline`. Existing migration files are immutable after release.

## Fresh installations

A database with no application tables is initialized with:

```bash
npx prisma migrate deploy
```

Prisma applies `0_baseline` and every later migration in order.

## Existing databases created by db push

Early HRBP builds used `prisma db push` and therefore have application tables without Prisma migration history.

The guarded deploy helper:

```bash
bash scripts/schema-migrate-deploy.sh
```

handles this transition fail-closed:

1. If `_prisma_migrations` already exists, run normal `prisma migrate deploy`.
2. If the database has no application tables, run normal `prisma migrate deploy`.
3. If application tables exist but migration history does not:
   - compare the live PostgreSQL schema with the current complete Prisma schema,
   - require an exact match,
   - only then mark `0_baseline` as applied with `prisma migrate resolve --applied 0_baseline`,
   - run `prisma migrate deploy` for later migrations.
4. If drift is detected, stop. Do not reset, force, drop or accept data loss automatically.

This adoption procedure records history; it does not replay the baseline CREATE statements over an existing database.

## Release rules

Schema changes are release-critical. A migration PR must:

- include the Prisma model change and its new migration together,
- pass Prisma validation and migration-history validation,
- apply successfully to a fresh disposable PostgreSQL database,
- apply successfully from the previous committed migration state,
- leave no schema drift against the current Prisma model,
- preserve application CI and platform regression,
- document any data backfill, long-running DDL, locking risk or manual prerequisite.

Do not edit an already released migration to make a later deployment pass. Add a forward migration instead.

## Destructive or high-risk changes

Automatic use of these patterns is prohibited in customer release paths:

- `prisma migrate reset`,
- `prisma db push --accept-data-loss`,
- automatic dropping of a customer database,
- automatic baseline resolution when schema drift exists.

Column/table removal, enum contraction, large backfills, uniqueness changes and non-null conversions require an explicit expand/migrate/contract plan where applicable.

The supported rollback for a migration that has already changed customer data is a reviewed forward fix or a release-aligned database/object-store restore. Migration files are not a general-purpose automatic rollback mechanism.

## Backup gate

Before customer schema upgrade, take and protect a completed backup with:

```bash
bash scripts/onprem-backup.sh <approved-backup-root>
```

The backup/restore recovery rehearsal in CI is a prerequisite to enabling versioned on-prem schema deployment. Customer RPO/RTO, retention and immutable/off-site storage remain deployment-specific operational requirements.
