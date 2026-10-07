#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${HRBP_ENV_FILE:-$ROOT_DIR/.env.onprem}"
COMPOSE_FILE="${HRBP_COMPOSE_FILE:-$ROOT_DIR/docker-compose.onprem.yml}"
export HRBP_ENV_FILE="$ENV_FILE"
BACKUP_ROOT="${HRBP_BACKUP_ROOT:-$ROOT_DIR/backups}"
ACKNOWLEDGED=false

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/onprem-upgrade.sh --maintenance-window [--env-file PATH] [--backup-root PATH]

The approved target release must already be checked out. This command never pulls
source code and never performs an automatic database rollback.
EOF
  exit 64
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --maintenance-window) ACKNOWLEDGED=true; shift ;;
    --env-file) [[ $# -ge 2 ]] || usage; ENV_FILE="$2"; shift 2 ;;
    --backup-root) [[ $# -ge 2 ]] || usage; BACKUP_ROOT="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ "$ACKNOWLEDGED" == "true" ]] || {
  printf 'ERROR: upgrade requires --maintenance-window acknowledgement.\n' >&2
  exit 64
}

command -v docker >/dev/null 2>&1 || { printf 'ERROR: docker is required.\n' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf 'ERROR: node is required.\n' >&2; exit 1; }

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TARGET_REVISION="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
if [[ ! "$TARGET_REVISION" =~ ^[a-f0-9]{40}$ ]]; then
  printf 'ERROR: upgrade requires a full Git target revision.\n' >&2
  exit 1
fi
export GITHUB_SHA="$TARGET_REVISION"

stage="preflight"
backup_dir=""

failure() {
  local code=$?
  printf '\nUPGRADE FAILED at stage: %s\n' "$stage" >&2
  if [[ -n "$backup_dir" ]]; then
    printf 'Verified pre-upgrade backup: %s\n' "$backup_dir" >&2
    printf 'Do not force migrations or blindly restart an older application against a changed schema.\n' >&2
    printf 'Inspect migration/container logs. If restore is required, check out the release recorded by the backup evidence and run:\n' >&2
    printf '  bash scripts/onprem-restore.sh %q --confirm-erase\n' "$backup_dir" >&2
  else
    printf 'No completed upgrade backup was recorded. Inspect the current stack before taking further action.\n' >&2
  fi
  exit "$code"
}
trap failure ERR

cd "$ROOT_DIR"

printf 'Running upgrade preflight...\n' >&2
node scripts/onprem-preflight.mjs --env-file "$ENV_FILE" --phase upgrade --require-clean-source

stage="current-health"
printf 'Verifying current deployment health before upgrade...\n' >&2
pre_upgrade_health="$(node scripts/onprem-postflight.mjs --env-file "$ENV_FILE" --mode pre-upgrade --timeout-seconds 120)"

stage="build"
printf 'Building target release before downtime...\n' >&2
"${COMPOSE[@]}" build schema app document-scanner maintenance-scheduler
"${COMPOSE[@]}" pull document-scanner-engine

stage="quiesce"
printf 'Entering maintenance window: stopping scheduled and user mutation surfaces...\n' >&2
"${COMPOSE[@]}" stop document-scanner maintenance-scheduler app >/dev/null

stage="backup"
printf 'Taking quiesced pre-upgrade backup...\n' >&2
backup_dir="$(HRBP_ENV_FILE="$ENV_FILE" HRBP_COMPOSE_FILE="$COMPOSE_FILE" bash scripts/onprem-backup.sh "$BACKUP_ROOT" | tail -n 1)"
[[ -d "$backup_dir" ]] || { printf 'ERROR: backup command did not return a completed backup directory.\n' >&2; false; }

printf '%s\n' "$pre_upgrade_health" > "$backup_dir/pre-upgrade-health.json"

cat > "$backup_dir/upgrade-intent.json" <<EOF
{
  "startedAtUtc": "$STARTED_AT",
  "targetRevision": "$TARGET_REVISION",
  "policy": "fail-closed-no-automatic-schema-rollback"
}
EOF
(
  cd "$backup_dir"
  sha256sum pre-upgrade-health.json upgrade-intent.json >> SHA256SUMS
)

stage="migration"
printf 'Applying committed database migration history...\n' >&2
"${COMPOSE[@]}" up -d postgres object-storage >/dev/null
"${COMPOSE[@]}" up --no-deps --abort-on-container-exit --exit-code-from schema schema

stage="start"
printf 'Starting target application, document scanner and maintenance scheduler...\n' >&2
"${COMPOSE[@]}" up -d --no-deps app
# Scanner and scheduler depend on a healthy app; the scanner also waits for ClamAV health.
"${COMPOSE[@]}" up -d document-scanner-engine document-scanner maintenance-scheduler

stage="postflight"
printf 'Running deployment postflight...\n' >&2
postflight="$(node scripts/onprem-postflight.mjs --env-file "$ENV_FILE" --mode post-deploy --timeout-seconds 600 --expected-revision "$TARGET_REVISION")"
printf '%s\n' "$postflight"

COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$backup_dir/upgrade-receipt.json" <<EOF
{
  "startedAtUtc": "$STARTED_AT",
  "completedAtUtc": "$COMPLETED_AT",
  "targetRevision": "$TARGET_REVISION",
  "backupDirectory": "$(basename "$backup_dir")",
  "result": "success"
}
EOF
(
  cd "$backup_dir"
  sha256sum upgrade-receipt.json >> SHA256SUMS
)

trap - ERR
printf 'Upgrade completed successfully. Backup and receipt: %s\n' "$backup_dir" >&2
