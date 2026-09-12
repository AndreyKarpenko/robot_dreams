#!/usr/bin/env bash
# Load DB_* (and the rest of the app env) from Infisical, then exec the command.
# Usage: bash scripts/with-secrets.sh [dev|prod] <command...>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"
if [ ! -f "$CREDS" ]; then
  echo "Missing Infisical credentials at $CREDS." >&2
  echo "Please either run infisical init to connect to a project or create that file." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CREDS"
set +a

if ! command -v infisical >/dev/null 2>&1; then
  echo "infisical CLI is not installed." >&2
  echo "Please either run infisical init to connect to a project or install the CLI." >&2
  exit 1
fi

exec infisical run --env="$ENV_SLUG" -- "$@"
