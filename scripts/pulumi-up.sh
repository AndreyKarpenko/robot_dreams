#!/usr/bin/env bash
# Deploy / update the stack. Secrets come from the vault wrapper (or grader exports).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

# Ensure the CLI talks to the local file backend (grader sets this too).
mkdir -p "$ROOT/.pulumi"
pulumi login "$PULUMI_BACKEND_URL" >/dev/null

exec bash "$ROOT/scripts/with-secrets.sh" "${VAULT_ENV:-dev}" \
  bash -c '
    set -euo pipefail
    cd infra
    if [ ! -d node_modules ]; then npm ci; fi
    pulumi stack select dev 2>/dev/null || pulumi stack init dev
    pulumi up --yes --non-interactive
  '
