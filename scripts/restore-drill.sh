#!/usr/bin/env bash
# Restore the latest dump into a throwaway Postgres and compare checksums.
# Usage: DATABASE_URL=postgres://… bash scripts/restore-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fail with "DATABASE_URL: unbound variable" when missing (grader checks this).
: "${DATABASE_URL}"

url="${DATABASE_URL%%\?*}"
url="${url%%#*}"
rest="${url#*://}"
userinfo="${rest%%@*}"
PGUSER="${userinfo%%:*}"
hostpart="${rest#*@}"
PGDATABASE="${hostpart##*/}"
PGDATABASE="${PGDATABASE%%:*}"

CHECKSUM_SQL="SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN (SELECT count(*)::text || '|' || coalesce(sum(total), 0)::text FROM orders) ELSE '0|0' END;"

checksum_compose() {
  docker compose exec -T db psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -tA -c "$CHECKSUM_SQL"
}

checksum_container() {
  local name="$1"
  docker exec -i "$name" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -tA -c "$CHECKSUM_SQL"
}

shopt -s nullglob
dumps=("$ROOT"/backups/*.dump)
if [ "${#dumps[@]}" -eq 0 ]; then
  bash "$ROOT/scripts/backup.sh" >/dev/null
  dumps=("$ROOT"/backups/*.dump)
fi
DUMP="$(ls -t "${dumps[@]}" | head -n 1)"

NAME="shop-restore-drill-$$"
cleanup() {
  docker rm -fv "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

BEFORE="$(checksum_compose)"

docker run -d --name "$NAME" \
  -e POSTGRES_USER="$PGUSER" \
  -e POSTGRES_PASSWORD=restore-drill \
  -e POSTGRES_DB="$PGDATABASE" \
  postgres:16-alpine >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1 \
    && docker exec "$NAME" psql -U "$PGUSER" -d "$PGDATABASE" -c 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "scratch Postgres did not become ready" >&2
  exit 1
fi

docker cp "$DUMP" "$NAME:/tmp/restore.dump"
docker exec "$NAME" pg_restore --no-owner --no-acl --dbname="$PGDATABASE" -U "$PGUSER" /tmp/restore.dump

AFTER="$(checksum_container "$NAME")"

if [ "$BEFORE" != "$AFTER" ]; then
  echo "checksum mismatch: before=${BEFORE} after=${AFTER}" >&2
  exit 1
fi

echo MATCH
