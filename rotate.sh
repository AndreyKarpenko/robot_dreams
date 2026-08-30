#!/usr/bin/env bash
# ALTER ROLE → secret file → close old connections. Do not restart the app.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE in Postgres…"
docker compose exec -T db psql -U admin -d shop \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Update secrets/db_password…"
printf '%s' "${NEW_PASSWORD}" > secrets/db_password

echo "3. Terminate old app_user backends…"
docker compose exec -T db psql -U admin -d shop -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"

echo "Done. App process was not restarted. Check: curl -s localhost:3000/db"
