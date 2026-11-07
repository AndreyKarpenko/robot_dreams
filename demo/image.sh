#!/usr/bin/env bash
# Measure production-image properties. Numbers are computed from the image, not printed by fiat.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${SCAN_IMAGE:-marketplace-api:hw28}"
TOKEN_FILE="${NPM_TOKEN_FILE:-$ROOT/.npm_token}"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "missing $TOKEN_FILE — run npm run image:build first" >&2
  exit 1
fi
TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"

# --- stages: count FROM lines in the Dockerfile (multi-stage ≥ 2) ---
STAGES="$(grep -cE '^[[:space:]]*FROM[[:space:]]' docker/Dockerfile || true)"

# --- shell-inside: try to exec sh (distroless → fail → 0) ---
SHELL_INSIDE=1
if ! docker run --rm --entrypoint sh "$IMAGE" -c 'echo shell' >/dev/null 2>&1; then
  SHELL_INSIDE=0
fi

# --- runtime-uid: numeric user from image config ---
RUNTIME_UID="$(docker image inspect "$IMAGE" --format '{{.Config.User}}' | awk -F: '{print $1}')"
if [[ "$RUNTIME_UID" =~ [^0-9] ]] || [ -z "$RUNTIME_UID" ]; then
  # Name like "nonroot" without a numeric USER — treat as unknown empty for the ≠0 check.
  # Distroless :nonroot sets USER to 65532 in the image config.
  RUNTIME_UID="$(docker image inspect "$IMAGE" --format '{{.Config.User}}')"
fi
# Normalize "65532" or "65532:65532"
RUNTIME_UID="$(printf '%s' "$RUNTIME_UID" | awk -F: '{print $1}')"

# --- token-in-history: docker history digs ARG / ENV / RUN strings ---
HISTORY_FILE="$(mktemp)"
trap 'rm -rf "$HISTORY_FILE" "$SAVE_DIR" "$SAVE_TAR"' EXIT
docker history --no-trunc "$IMAGE" >"$HISTORY_FILE" 2>/dev/null || true
TOKEN_IN_HISTORY="$(grep -cF -- "$TOKEN" "$HISTORY_FILE" || true)"

# --- token-in-config: image inspect JSON ---
CONFIG_JSON="$(mktemp)"
docker image inspect "$IMAGE" >"$CONFIG_JSON"
TOKEN_IN_CONFIG="$(grep -cF -- "$TOKEN" "$CONFIG_JSON" || true)"
rm -f "$CONFIG_JSON"

# --- token-in-layers: docker save + unpack (catches COPY+rm whiteout leftovers) ---
SAVE_TAR="$(mktemp -t img-XXXXXX.tar)"
SAVE_DIR="$(mktemp -d)"
docker save "$IMAGE" -o "$SAVE_TAR"
tar -xf "$SAVE_TAR" -C "$SAVE_DIR"
TOKEN_IN_LAYERS=0
# Search layer tarballs and JSON metadata for the decoy string.
if grep -RFa -- "$TOKEN" "$SAVE_DIR" >/dev/null 2>&1; then
  TOKEN_IN_LAYERS=1
else
  # Also peek inside compressed layer blobs
  while IFS= read -r -d '' layer; do
    if tar -xOf "$layer" 2>/dev/null | grep -Fa -- "$TOKEN" >/dev/null 2>&1; then
      TOKEN_IN_LAYERS=1
      break
    fi
  done < <(find "$SAVE_DIR" -type f \( -name 'layer.tar' -o -name '*.tar' \) -print0 2>/dev/null)
fi

echo "stages=$STAGES"
echo "shell-inside=$SHELL_INSIDE"
echo "runtime-uid=$RUNTIME_UID"
echo "token-in-history=$TOKEN_IN_HISTORY"
echo "token-in-config=$TOKEN_IN_CONFIG"
echo "token-in-layers=$TOKEN_IN_LAYERS"
