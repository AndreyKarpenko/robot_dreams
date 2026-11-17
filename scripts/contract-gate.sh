#!/usr/bin/env bash
set -euo pipefail
BASE="${CONTRACT_BASE:-openapi/baseline.yaml}"
HEAD="${CONTRACT_HEAD:-openapi/openapi.yaml}"
if command -v oasdiff >/dev/null 2>&1; then
  oasdiff breaking "$BASE" "$HEAD" --fail-on ERR
elif [ -x .bin/oasdiff ]; then
  .bin/oasdiff breaking "$BASE" "$HEAD" --fail-on ERR
else
  docker run --rm -v "$PWD:/work:ro" -w /work tufin/oasdiff:1.11.7 breaking "$BASE" "$HEAD" --fail-on ERR
fi
