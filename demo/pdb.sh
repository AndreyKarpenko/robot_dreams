#!/usr/bin/env bash
# Exercise the PodDisruptionBudget via the Eviction API (not kubectl delete pod).
# HTTP status is measured from the API response: 201 allowed, 429 budget spent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NS="${K8S_NAMESPACE:-marketplace}"
PDB="${K8S_PDB:-marketplace-api}"
DEPLOY="${K8S_DEPLOYMENT:-marketplace-api}"

kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=120s >/dev/null
for _ in $(seq 1 45); do
  ready="$(kubectl -n "$NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}')"
  desired="$(kubectl -n "$NS" get deploy "$DEPLOY" -o jsonpath='{.status.replicas}')"
  allowed="$(kubectl -n "$NS" get pdb "$PDB" -o jsonpath='{.status.disruptionsAllowed}')"
  if [ "${ready:-0}" = "${desired:-0}" ] && [ "${allowed:-0}" -ge 1 ]; then
    break
  fi
  sleep 1
done

HEALTHY="$(kubectl -n "$NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}')"
MIN_AVAILABLE="$(kubectl -n "$NS" get pdb "$PDB" -o jsonpath='{.spec.minAvailable}')"

pick_pod() {
  local exclude="${1:-}"
  kubectl -n "$NS" get pods -l app=marketplace-api \
    --field-selector=status.phase=Running \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
    | { if [ -n "$exclude" ]; then grep -v "^${exclude}$" || true; else cat; fi; } \
    | head -1
}

# Returns measured HTTP-ish code: 201 or 429 (or other).
evict() {
  local pod="$1"
  local body errfile
  body="$(mktemp)"
  errfile="$(mktemp)"
  cat >"$body" <<EOF
{
  "apiVersion": "policy/v1",
  "kind": "Eviction",
  "metadata": {
    "name": "$pod",
    "namespace": "$NS"
  }
}
EOF
  # kubectl ≥1.33: --raw and -o are mutually exclusive — no -o here.
  set +e
  kubectl create --raw "/api/v1/namespaces/${NS}/pods/${pod}/eviction" -f "$body" \
    >"${body}.out" 2>"$errfile"
  local rc=$?
  set -e
  local combined
  combined="$(cat "${body}.out" "$errfile" 2>/dev/null || true)"
  rm -f "$body" "${body}.out" "$errfile"

  if [ "$rc" -eq 0 ]; then
    echo 201
    return
  fi
  # PDB denial is HTTP 429 Too Many Requests.
  if echo "$combined" | grep -qiE '429|Too Many Requests|Cannot evict|disruption budget'; then
    echo 429
    return
  fi
  echo "eviction error for $pod (exit=$rc): $combined" >&2
  echo 500
}

POD1="$(pick_pod)"
if [ -z "$POD1" ]; then
  echo "no running pod in $NS" >&2
  exit 1
fi
EVICT1="$(evict "$POD1")"

sleep 0.2
POD2="$(pick_pod "$POD1")"
if [ -z "$POD2" ]; then
  sleep 1
  POD2="$(pick_pod "$POD1")"
fi
if [ -z "$POD2" ]; then
  POD2="$(pick_pod)"
fi
EVICT2="$(evict "$POD2")"

echo "healthy=$HEALTHY"
echo "minAvailable=$MIN_AVAILABLE"
echo "evict-1=$EVICT1"
echo "evict-2=$EVICT2"

# Leave the Deployment healthy for the next demo.
kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=180s >/dev/null || true

if [ "$EVICT1" != "201" ] || [ "$EVICT2" != "429" ]; then
  exit 1
fi
exit 0
