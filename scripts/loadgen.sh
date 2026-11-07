#!/usr/bin/env bash
# Thin wrapper — the real generator is scripts/loadgen.mjs (one Node process).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/loadgen.mjs" "$@"
