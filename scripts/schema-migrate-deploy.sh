#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCHEMA_DIR="$ROOT_DIR/prisma"
BASELINE_MIGRATION="0_baseline"
BASELINE_SQL="$SCHEMA_DIR/migrations/$BASELINE_MIGRATION/migration.sql"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is required"
[[ -s "$BASELINE_SQL" ]] || fail "baseline migration is missing: $BASELINE_SQL"

cd "$ROOT_DIR"
npx prisma validate >/dev/null

read -r migrations_table user_tables <<EOF
$(node --input-type=module <<'NODE'
import pg from "pg";
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(`
    SELECT
      to_regclass('public._prisma_migrations') IS NOT NULL AS migrations_table,
      (
        SELECT count(*)::int
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
      ) AS user_tables
  `);
  const row = result.rows[0];
  process.stdout.write(`${row.migrations_table ? "yes" : "no"} ${row.user_tables}\n`);
} finally {
  await client.end();
}
NODE
)
EOF

if [[ "$migrations_table" == "yes" ]]; then
  printf 'Applying pending versioned Prisma migrations...\n' >&2
  exec npx prisma migrate deploy
fi

if [[ "$user_tables" == "0" ]]; then
  printf 'Empty database detected; applying baseline and pending migrations...\n' >&2
  exec npx prisma migrate deploy
fi

printf 'Existing pre-migration HRBP database detected; verifying exact schema before baseline adoption...\n' >&2
set +e
npx prisma migrate diff   --from-url "$DATABASE_URL"   --to-schema "$SCHEMA_DIR"   --exit-code   > /tmp/hrbp-prisma-migration-diff.txt 2>&1
diff_status=$?
set -e

case "$diff_status" in
  0)
    printf 'Existing schema matches the current Prisma model. Recording baseline without replaying CREATE statements...\n' >&2
    npx prisma migrate resolve --applied "$BASELINE_MIGRATION"
    exec npx prisma migrate deploy
    ;;
  2)
    cat /tmp/hrbp-prisma-baseline-diff.txt >&2
    fail "database schema differs from the approved baseline; refusing automatic adoption"
    ;;
  *)
    cat /tmp/hrbp-prisma-baseline-diff.txt >&2
    fail "could not verify existing database schema for baseline adoption"
    ;;
esac
