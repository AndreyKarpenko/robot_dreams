#!/usr/bin/env bash
set -euo pipefail
# LocalStack lane: preview the optional NAT; no AWS billing measurement is claimed.
pulumi -C infra/demo config set hw31:withNat true --stack local
trap 'pulumi -C infra/demo config rm hw31:withNat --stack local' EXIT
bash scripts/hw31.sh preview
bash scripts/hw31.sh attempt-demo
