#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
mkdir -p "$ROOT/.pulumi"
pulumi login "$PULUMI_BACKEND_URL" >/dev/null

exec bash "$ROOT/scripts/with-secrets.sh" "${VAULT_ENV:-dev}" \
  bash -c '
    set -euo pipefail
    cd infra
    if [ ! -d node_modules ]; then npm ci; fi
    pulumi destroy --yes --non-interactive || true
  '
