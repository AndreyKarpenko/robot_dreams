#!/usr/bin/env bash
# Create the local kind cluster and load the production image into it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLUSTER_NAME="${KIND_CLUSTER_NAME:-hw28}"
IMAGE="${SCAN_IMAGE:-marketplace-api:hw28}"
CONFIG="$ROOT/k8s/kind-config.yaml"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is not installed. Install: https://kind.sigs.k8s.io/docs/user/quick-start/#installation" >&2
  exit 1
fi

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  kind create cluster --name "$CLUSTER_NAME" --config "$CONFIG"
else
  echo "kind cluster '$CLUSTER_NAME' already exists"
  kubectl cluster-info --context "kind-$CLUSTER_NAME" >/dev/null
fi

# Image built on the host does not exist inside the nodes until loaded.
kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"
echo "cluster=$CLUSTER_NAME image-loaded=$IMAGE"
