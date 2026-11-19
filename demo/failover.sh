#!/usr/bin/env bash
set -euo pipefail
# LocalStack lane: collect the mandatory code preview and actual license failure.
# No fabricated HTTP/AZ measurements are appended to demos.txt.
bash scripts/hw31.sh preview
bash scripts/hw31.sh attempt-demo
