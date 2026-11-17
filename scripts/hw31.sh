#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PULUMI_HOME="$ROOT/.pulumi/hw31/home"
export PULUMI_BACKEND_URL="file://$ROOT/.pulumi/hw31/state"
export PULUMI_CONFIG_PASSPHRASE='localstack-public-state-only'
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=eu-central-1
export AWS_EC2_METADATA_DISABLED=true
mkdir -p "$PULUMI_HOME" "$ROOT/.pulumi/hw31/state" evidence
ps() { pulumi -C "infra/$1" "${@:2}" --stack local; }
init() { pulumi -C "infra/$1" stack select local --create >/dev/null; }
case "${1:-}" in
 start) docker compose -f infra/hw31/compose.yaml up -d --wait ;;
 up:base|up:demo)
   stack="${1#up:}"; init "$stack"; ps "$stack" up --yes --non-interactive ;;
 destroy:base|destroy:demo)
   stack="${1#destroy:}"; init "$stack"; ps "$stack" destroy --yes --non-interactive ;;
 verify) python3 scripts/hw31-evidence.py base ;;
 iam) python3 scripts/hw31-evidence.py iam ;;
 demo:*) bash "demo/${1#demo:}.sh" ;;
 preview)
   init demo
   ps demo preview --refresh=false --non-interactive --color never --json 2>&1 | tee evidence/preview-demo.txt ;;
 attempt-demo)
   init demo
   rm -f evidence/501.txt
   set +e
   ps demo up --yes --non-interactive --color never 2>&1 | tee evidence/501.txt
   result=${PIPESTATUS[0]}
   set -e
   [ "$result" -ne 0 ]
   grep -qE 'StatusCode: 501' evidence/501.txt
   grep -qE 'not included (within your LocalStack license|in your current license plan)' evidence/501.txt ;;
 teardown)
   init demo; init base
   ps demo destroy --yes --non-interactive
   ps demo stack export > /tmp/hw31-demo-state.json
   ps base destroy --yes --non-interactive
   ps base stack export > /tmp/hw31-base-state.json
   python3 scripts/hw31-evidence.py teardown ;;
 *) echo 'Usage: hw31.sh start|up:base|up:demo|destroy:base|destroy:demo|verify|iam|preview|attempt-demo|teardown|demo:alb|demo:nat|demo:failover' >&2; exit 2 ;;
esac
