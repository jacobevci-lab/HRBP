# HRBP One — Database migration engineering standard

HRBP One treats database migration history as release code. Production, staging and on-prem upgrade paths must be reproducible from committed migrations and must never depend on `prisma db push`.

## Current baseline

The immutable baseline migration is:

`20261007000000_baseline_current_schema`

It represents the complete schema that existed when versioned migrations were introduced. The same immutable datamodel is frozen under `prisma/baseline-20261007000000/`.

Existing installations without Prisma migration history are eligible for baseline adoption only when the live database schema is an exact match for **that frozen baseline datamodel**, not the current evolving application datamodel. This distinction is required so a legacy installation can first adopt the baseline and then safely receive every later committed migration.

Never edit either the baseline migration SQL or the frozen baseline datamodel snapshot after adoption. Add a new migration.

## Creating a schema change

1. Work against a disposable developer PostgreSQL database.
2. Update the relevant files under `prisma/`.
3. Generate a migration with a timestamped, descriptive name:
   ```bash
   npx prisma migrate dev --schema prisma --name add_example_capability
   ```
4. Review the generated `migration.sql` line by line.
5. Run:
   ```bash
   npm run db:migrate:files:validate
   npm run db:migrate:verify
   npm run typecheck
   ```
6. Verify the affected product workflow with realistic data before submitting the PR.

A datamodel change without a matching committed migration will fail the migration-history parity gate.

## Safe migration design

Prefer expand/migrate/contract changes:

- add nullable/new structures first,
- deploy application code capable of reading both old and new forms where required,
- backfill in bounded, observable batches,
- enforce new constraints only after data is proven compatible,
- remove old columns/tables in a later reviewed release.

For large tables, avoid long blocking rewrites and unbounded data updates inside a single transaction. Index and constraint operations must be reviewed for PostgreSQL locking behavior and expected customer dataset size.

## Destructive DDL

Future migrations containing `DROP TABLE`, `DROP COLUMN`, `DROP TYPE` or column type replacement are rejected unless the SQL contains an explicit review marker:

```sql
-- HRBP_DESTRUCTIVE_CHANGE_REVIEWED: <change/ticket and recovery rationale>
```

The marker is not an approval by itself. It forces the destructive intent to be visible in code review. The release still requires a current backup, recovery path, compatibility analysis and customer maintenance plan where applicable.

`DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE` and destructive-force flags are prohibited in committed product migrations.

## Fresh installation

A fresh database is created only from committed history:

```bash
npm run db:migrate:deploy
```

The resulting database must match the current Prisma datamodel with no drift.

## Existing installation with migration history

Use:

```bash
npm run db:migrate:upgrade
```

The runner detects `_prisma_migrations` and applies only pending committed migrations.

## Legacy installation without migration history

The same upgrade command performs guarded baseline adoption:

```bash
npm run db:migrate:upgrade
```

It first compares the live schema to `prisma/baseline-20261007000000/`.

- exact baseline-era match: the immutable baseline is marked applied and normal migration deployment continues through every later committed migration;
- any difference from the frozen baseline: the operation stops and no migration marker is written.

The current application datamodel is deliberately **not** used for this legacy eligibility decision. Otherwise the first post-baseline schema change would incorrectly make every legitimate pre-migration installation look drifted.

Never work around a failed parity check with `migrate resolve` or `db push` on a customer database. Reconcile the database with a reviewed migration/recovery plan.

## Release verification

CI creates disposable PostgreSQL databases and verifies:

- fresh migration deployment,
- migration-history-to-datamodel parity through a shadow database,
- repeated/idempotent deploy on an already migrated database,
- exact legacy baseline adoption,
- refusal of a drifted legacy database without writing migration history.

The on-prem recovery rehearsal remains a separate gate proving database and object-storage restoration.

## Failed migration handling

Do not automatically retry or mark a failed production migration as applied.

1. Stop the rollout.
2. Preserve migration logs and database state.
3. Check `npm run db:migrate:status`.
4. Determine whether the migration transaction committed, rolled back, or partially applied.
5. Use a reviewed Prisma `migrate resolve --rolled-back` / `--applied` operation only when the actual database state has been independently verified.
6. Restore from the pre-upgrade backup when that is the safer recovery path.
7. Produce a corrected forward migration; do not rewrite migration files that have already been released.

## Rollback principle

Schema rollback is not assumed to be automatically reversible. HRBP One defaults to forward fixes or backup restore. A down migration is allowed only when it was explicitly designed, tested and reviewed for that release.
