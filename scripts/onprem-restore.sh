#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${HRBP_ENV_FILE:-$ROOT_DIR/.env.onprem}"
COMPOSE_FILE="${HRBP_COMPOSE_FILE:-$ROOT_DIR/docker-compose.onprem.yml}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/onprem-restore.sh BACKUP_DIR --confirm-erase

This is destructive. It stops the application, recreates the configured
PostgreSQL database, and synchronizes the backup object set over the live
S3-compatible bucket. The application is deliberately left stopped after restore.
EOF
  exit 64
}

[[ $# -eq 2 ]] || usage
BACKUP_DIR="$1"
[[ "$2" == "--confirm-erase" ]] || usage

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || fail "compose file not found: $COMPOSE_FILE"
[[ -d "$BACKUP_DIR" ]] || fail "backup directory not found: $BACKUP_DIR"

BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
[[ ! -e "$BACKUP_DIR/.incomplete" ]] || fail "backup is marked incomplete"
for required in postgres.dump manifest.json runtime-health.json images.json migration-history.json scheduler-status.json SHA256SUMS objects; do
  [[ -e "$BACKUP_DIR/$required" ]] || fail "backup is missing $required"
done
if find "$BACKUP_DIR/objects" -type l -print -quit | grep -q .; then
  fail "object backup contains symlinks; refusing restore"
fi

printf 'Verifying backup integrity...\n' >&2
(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS
)

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config >/dev/null

printf 'Stopping application mutation surfaces...\n' >&2
"${COMPOSE[@]}" stop maintenance-scheduler app schema >/dev/null 2>&1 || true

printf 'Starting recovery dependencies...\n' >&2
"${COMPOSE[@]}" up -d --wait postgres object-storage >/dev/null

"${COMPOSE[@]}" exec -T postgres sh -ec '
  case "$POSTGRES_DB" in
    ""|postgres|template0|template1) echo "refusing to replace reserved database: $POSTGRES_DB" >&2; exit 64 ;;
  esac
'

printf 'Validating PostgreSQL archive...\n' >&2
"${COMPOSE[@]}" exec -T postgres pg_restore --list >/dev/null < "$BACKUP_DIR/postgres.dump"

printf 'Recreating PostgreSQL database...\n' >&2
"${COMPOSE[@]}" exec -T postgres sh -ec '
  dropdb --if-exists --force -U "$POSTGRES_USER" "$POSTGRES_DB"
  createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"
'
"${COMPOSE[@]}" exec -T postgres sh -ec \
  'exec pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$BACKUP_DIR/postgres.dump"

printf 'Restoring private S3-compatible object storage...\n' >&2
"${COMPOSE[@]}" run --rm --no-deps -T \
  -v "$BACKUP_DIR/objects:/backup:ro" \
  --entrypoint /bin/sh object-storage-tool -ec '
    exec rclone sync /backup "hrbp:$OBJECT_STORAGE_BUCKET" --create-empty-src-dirs --delete-during
  '

printf 'Restoring maintenance scheduler safety latch...\n' >&2
"${COMPOSE[@]}" run --rm --no-deps -T \
  -v "$BACKUP_DIR/scheduler-status.json:/restore/scheduler-status.json:ro" \
  maintenance-scheduler node scripts/onprem-restore-scheduler-state.mjs /restore/scheduler-status.json

printf '\nRestore completed. The application and maintenance scheduler remain stopped by design.\n' >&2
printf 'Before reopening service, check out the release recorded by runtime-health.json/images.json, review schema compatibility, then start the stack and perform the documented smoke tests.\n' >&2
