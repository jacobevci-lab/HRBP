#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${HRBP_DISPOSABLE_RECOVERY_REHEARSAL:-}" == "true" ]] || {
  printf 'ERROR: set HRBP_DISPOSABLE_RECOVERY_REHEARSAL=true to run the isolated destructive rehearsal.\n' >&2
  exit 64
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export HRBP_ENV_FILE="${HRBP_ENV_FILE:-$ROOT_DIR/.env.onprem}"
export HRBP_COMPOSE_FILE="${HRBP_COMPOSE_FILE:-$ROOT_DIR/docker-compose.onprem.yml}"
[[ -f "$HRBP_ENV_FILE" ]] || { printf 'ERROR: missing %s\n' "$HRBP_ENV_FILE" >&2; exit 1; }

RECOVERY_ID="${GITHUB_RUN_ID:-$$}"
export COMPOSE_PROJECT_NAME="hrbp-recovery-$RECOVERY_ID"
export POSTGRES_DB="hrbp_recovery"
BACKUP_ROOT="${HRBP_RECOVERY_REHEARSAL_DIR:-/tmp/hrbp-recovery-$RECOVERY_ID}"

case "$COMPOSE_PROJECT_NAME" in
  hrbp-recovery-*) ;;
  *) printf 'ERROR: unsafe rehearsal project name\n' >&2; exit 64 ;;
esac

COMPOSE=(docker compose --env-file "$HRBP_ENV_FILE" -f "$HRBP_COMPOSE_FILE")
cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$BACKUP_ROOT"
}
trap cleanup EXIT

rm -rf "$BACKUP_ROOT"
mkdir -p "$BACKUP_ROOT"

printf 'Starting isolated recovery rehearsal stack %s...\n' "$COMPOSE_PROJECT_NAME" >&2
"${COMPOSE[@]}" up -d --wait postgres object-storage >/dev/null

"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint /bin/sh object-storage-tool -ec '
  printf original-object | rclone rcat "hrbp:$OBJECT_STORAGE_BUCKET/recovery-probe.txt"
'

"${COMPOSE[@]}" exec -T postgres sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null <<'SQL'
CREATE TABLE recovery_probe (id integer PRIMARY KEY, value text NOT NULL);
INSERT INTO recovery_probe (id, value) VALUES (1, 'original-db');
SQL

BACKUP_DIR="$(bash "$ROOT_DIR/scripts/onprem-backup.sh" "$BACKUP_ROOT" | tail -n 1)"
[[ -d "$BACKUP_DIR" ]] || { printf 'ERROR: backup was not created\n' >&2; exit 1; }

printf 'Mutating isolated data after backup...\n' >&2
"${COMPOSE[@]}" exec -T postgres sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null <<'SQL'
UPDATE recovery_probe SET value = 'mutated-db' WHERE id = 1;
CREATE TABLE should_disappear (id integer PRIMARY KEY);
INSERT INTO should_disappear (id) VALUES (1);
SQL
"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint /bin/sh object-storage-tool -ec '
  printf mutated-object | rclone rcat "hrbp:$OBJECT_STORAGE_BUCKET/recovery-probe.txt"
  printf extra-object | rclone rcat "hrbp:$OBJECT_STORAGE_BUCKET/recovery-extra.txt"
'

bash "$ROOT_DIR/scripts/onprem-restore.sh" "$BACKUP_DIR" --confirm-erase >/dev/null

db_value="$(
  "${COMPOSE[@]}" exec -T postgres sh -ec 'psql -Atq -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | tr -d '\r\n'
SELECT value FROM recovery_probe WHERE id = 1;
SQL
)"
[[ "$db_value" == "original-db" ]] || {
  printf 'ERROR: database restore mismatch: %s\n' "$db_value" >&2
  exit 1
}

extra_table="$(
  "${COMPOSE[@]}" exec -T postgres sh -ec 'psql -Atq -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | tr -d '\r\n'
SELECT to_regclass('public.should_disappear') IS NULL;
SQL
)"
[[ "$extra_table" == "t" ]] || {
  printf 'ERROR: restore did not remove post-backup database objects\n' >&2
  exit 1
}

object_value="$("${COMPOSE[@]}" run --rm --no-deps -T --entrypoint /bin/sh object-storage-tool -ec '
  rclone cat "hrbp:$OBJECT_STORAGE_BUCKET/recovery-probe.txt"
' 2>/dev/null)"
[[ "$object_value" == "original-object" ]] || {
  printf 'ERROR: object restore mismatch: %s\n' "$object_value" >&2
  exit 1
}

if "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint /bin/sh object-storage-tool -ec '
  rclone lsf "hrbp:$OBJECT_STORAGE_BUCKET/recovery-extra.txt" | grep -q .
' >/dev/null 2>&1; then
  printf 'ERROR: restore did not remove post-backup object\n' >&2
  exit 1
fi

printf 'On-prem recovery rehearsal passed: database and object store returned to the exact backed-up state.\n'
