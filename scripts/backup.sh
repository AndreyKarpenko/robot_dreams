#!/usr/bin/env bash
# Dump the course database (custom format) to ./backups with today's date.
# Usage: DATABASE_URL=postgres://… bash scripts/backup.sh
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
if [ "$userinfo" = "${userinfo%%:*}" ]; then
  PGPASSWORD=""
else
  PGPASSWORD="${userinfo#*:}"
fi
hostpart="${rest#*@}"
PGDATABASE="${hostpart##*/}"
PGDATABASE="${PGDATABASE%%:*}"
hostport="${hostpart%%/*}"
if [ "$hostport" = "${hostport##*:}" ]; then
  PGHOST="$hostport"
  PGPORT=5432
else
  PGHOST="${hostport%:*}"
  PGPORT="${hostport##*:}"
fi

DEST_DIR="$ROOT/backups"
mkdir -p "$DEST_DIR"

STAMP="$(date +%Y-%m-%d)"
FILE="$DEST_DIR/shop-${STAMP}.dump"

# Dump against DATABASE_URL host/port (not `docker compose exec db`), so the
# script works outside this compose project. localhost is rewritten so a
# client container can reach ports published on the Docker host.
dump_host="$PGHOST"
case "$PGHOST" in
  127.0.0.1|localhost|::1) dump_host=host.docker.internal ;;
esac

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$PGPASSWORD" \
  postgres:16-alpine \
  pg_dump -Fc -h "$dump_host" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE" >"$FILE"

echo "$FILE"
