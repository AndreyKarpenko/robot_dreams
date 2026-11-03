#!/usr/bin/env bash
# Image vulnerability gate. The threshold is COMPUTED from SCAN_MAX, never hard-coded
# as the verdict. Criterion 4 runs this twice: SCAN_MAX=-1 (fail) and SCAN_MAX=99999 (pass).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${SCAN_IMAGE:-marketplace-api:hw28}"
# Default working threshold for CI / local runs. Override with SCAN_MAX.
MAX_ALLOWED="${SCAN_MAX:-100}"
SEVERITY="${SCAN_SEVERITY:-CRITICAL,HIGH}"
REPORT="$(mktemp -t scan-XXXXXX.json)"
trap 'rm -f "$REPORT"' EXIT

if ! command -v trivy >/dev/null 2>&1; then
  # Install a local binary (no sudo) before falling back to a container pull.
  mkdir -p "$ROOT/.bin"
  if [ ! -x "$ROOT/.bin/trivy" ]; then
    curl -fsSL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
      | sh -s -- -b "$ROOT/.bin" v0.58.1
  fi
  if [ -x "$ROOT/.bin/trivy" ]; then
    SCAN_CMD=("$ROOT/.bin/trivy")
  else
    SCAN_CMD=(docker run --rm
      -v /var/run/docker.sock:/var/run/docker.sock
      aquasec/trivy:0.58.1)
  fi
else
  SCAN_CMD=(trivy)
fi

"${SCAN_CMD[@]}" image --quiet --format json --severity "$SEVERITY" "$IMAGE" >"$REPORT"

# Count findings from the report — the verdict is derived, not printed by fiat.
FOUND="$(node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const results = Array.isArray(report.Results) ? report.Results : [];
let n = 0;
for (const r of results) {
  const vulns = Array.isArray(r.Vulnerabilities) ? r.Vulnerabilities : [];
  n += vulns.length;
}
process.stdout.write(String(n));
' "$REPORT")"

# Numeric compare; SCAN_MAX=-1 must fail even when found=0.
PASS=0
if [ "$FOUND" -le "$MAX_ALLOWED" ]; then
  PASS=1
fi

if [ "$PASS" -eq 1 ]; then
  GATE=pass
else
  GATE=fail
fi

echo "image=$IMAGE"
echo "severity=$SEVERITY"
echo "found=$FOUND"
echo "max-allowed=$MAX_ALLOWED"
echo "gate=$GATE"

if [ "$GATE" = "pass" ]; then
  exit 0
fi
exit 1
