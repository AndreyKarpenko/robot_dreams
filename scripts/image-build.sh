#!/usr/bin/env bash
# Build the production image with BuildKit (secret-mounted decoy / registry token).
# Entrypoint JS is committed as docker/k8s-app.js (compiled from src/k8s-app.ts) so
# CI does not need a host TypeScript install — npx tsc alone pulls the wrong package.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${SCAN_IMAGE:-marketplace-api:hw28}"
TOKEN_FILE="${NPM_TOKEN_FILE:-$ROOT/.npm_token}"

if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 24 >"$TOKEN_FILE"
  echo "wrote decoy token to $TOKEN_FILE (gitignored)"
fi

if [ ! -f docker/k8s-app.js ]; then
  echo "missing docker/k8s-app.js — compile with:" >&2
  echo "  npx tsc src/k8s-app.ts --outDir docker --esModuleInterop --module commonjs --target ES2022 --moduleResolution node --skipLibCheck --strict" >&2
  exit 1
fi

export DOCKER_BUILDKIT=1
docker build \
  --secret "id=npm_token,src=$TOKEN_FILE" \
  -t "$IMAGE" \
  -f docker/Dockerfile \
  .

echo "image=$IMAGE"
