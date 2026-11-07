#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-hw28}"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is not installed" >&2
  exit 1
fi

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  kind delete cluster --name "$CLUSTER_NAME"
  echo "cluster-deleted=$CLUSTER_NAME"
else
  echo "cluster-absent=$CLUSTER_NAME"
fi
