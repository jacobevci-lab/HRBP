#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${HRBP_ENV_FILE:-$ROOT_DIR/.env.onprem}"
COMPOSE_FILE="${HRBP_COMPOSE_FILE:-$ROOT_DIR/docker-compose.onprem.yml}"
BACKUP_ROOT="${1:-${HRBP_BACKUP_ROOT:-$ROOT_DIR/backups}}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || fail "compose file not found: $COMPOSE_FILE"

mkdir -p "$BACKUP_ROOT"
BACKUP_ROOT="$(cd "$BACKUP_ROOT" && pwd -P)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_ROOT/hrbp-$STAMP"
if [[ -e "$TARGET" ]]; then
  TARGET="$BACKUP_ROOT/hrbp-$STAMP-$$"
fi
mkdir -p "$TARGET/objects"
touch "$TARGET/.incomplete"

trap 'printf "Backup failed; partial backup retained at %s with .incomplete marker.\n" "$TARGET" >&2' ERR

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" config >/dev/null

printf 'Backing up PostgreSQL...\n' >&2
"${COMPOSE[@]}" exec -T postgres sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null'
"${COMPOSE[@]}" exec -T postgres sh -ec \
  'exec pg_dump --format=custom --compress=6 --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$TARGET/postgres.dump"

printf 'Backing up private S3-compatible object storage...\n' >&2
"${COMPOSE[@]}" run --rm --no-deps -T \
  -v "$TARGET/objects:/backup" \
  --entrypoint /bin/sh object-storage-tool -ec '
    exec rclone sync "hrbp:$OBJECT_STORAGE_BUCKET" /backup --create-empty-src-dirs
  '

printf 'Capturing release metadata...\n' >&2
if "${COMPOSE[@]}" exec -T app node -e \
  "fetch('http://127.0.0.1:3000/api/health/runtime').then(async r=>{const t=await r.text();if(!r.ok)process.exit(2);process.stdout.write(t)}).catch(()=>process.exit(3))" \
  > "$TARGET/runtime-health.json" 2>/dev/null; then
  :
else
  printf '{"available":false,"reason":"application-not-running-or-unhealthy"}\n' > "$TARGET/runtime-health.json"
fi

if ! "${COMPOSE[@]}" images --format json > "$TARGET/images.json" 2>/dev/null; then
  printf '[]\n' > "$TARGET/images.json"
fi

cat > "$TARGET/manifest.json" <<EOF
{
  "formatVersion": 1,
  "createdAtUtc": "$STAMP",
  "databaseFormat": "postgres-custom",
  "objectFormat": "s3-rclone-mirror",
  "restorePolicy": "verify-checksums-and-explicit-erase-confirmation"
}
EOF

(
  cd "$TARGET"
  sha256sum postgres.dump manifest.json runtime-health.json images.json > SHA256SUMS
  while IFS= read -r -d '' file; do
    sha256sum "$file"
  done < <(find objects -type f -print0 | sort -z) >> SHA256SUMS
)

rm -f "$TARGET/.incomplete"
chmod -R go-rwx "$TARGET"

printf 'Backup completed: %s\n' "$TARGET" >&2
printf '%s\n' "$TARGET"
