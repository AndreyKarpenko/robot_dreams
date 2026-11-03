#!/usr/bin/env bash
# Compile the entrypoint on the host, then build with BuildKit (secret-mounted token).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${SCAN_IMAGE:-marketplace-api:hw28}"
TOKEN_FILE="${NPM_TOKEN_FILE:-$ROOT/.npm_token}"

if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 24 >"$TOKEN_FILE"
  echo "wrote decoy token to $TOKEN_FILE (gitignored)"
fi

# Host compile — Docker build context gets plain JS (no @types/node needed inside).
npx tsc src/k8s-app.ts \
  --outDir docker \
  --esModuleInterop \
  --module commonjs \
  --target ES2022 \
  --moduleResolution node \
  --skipLibCheck \
  --strict

export DOCKER_BUILDKIT=1
docker build \
  --secret "id=npm_token,src=$TOKEN_FILE" \
  -t "$IMAGE" \
  -f docker/Dockerfile \
  .

echo "image=$IMAGE"
