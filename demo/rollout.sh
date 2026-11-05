#!/usr/bin/env bash
# Zero-downtime rolling update under load. failed/ok/requests are counted from a file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NS="${K8S_NAMESPACE:-marketplace}"
DEPLOY="${K8S_DEPLOYMENT:-marketplace-api}"
PROFILE="${ROLLOUT_PROFILE:-correct}"
URL="${LOAD_URL:-http://127.0.0.1:30080/}"
CONCURRENCY="${LOAD_CONCURRENCY:-8}"
MIN_SECONDS="${LOAD_MIN_SECONDS:-35}"
export LOAD_PACE_MS="${LOAD_PACE_MS:-5}"
RESULTS="$(mktemp -t rollout-XXXXXX.codes)"
CONTROL="$(mktemp -t rollout-XXXXXX.ctrl)"
trap 'rm -f "$RESULTS" "$CONTROL"; kill $(jobs -p) 2>/dev/null || true' EXIT

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
mkdir -p "$ROOT/.pulumi"
pulumi login "$PULUMI_BACKEND_URL" >/dev/null

# Wait until the Service answers before measuring.
for _ in $(seq 1 90); do
  code=$(curl -o /dev/null -s -w '%{http_code}' --max-time 2 "$URL" || true)
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 1
done

# Quiet the cluster first — leftover Terminating pods from a prior rev still
# hold keep-alive conntrack entries and show up as failed≠0 under load.
for _ in $(seq 1 60); do
  term="$(kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -c Terminating || true)"
  not_ready="$(kubectl -n "$NS" get pods --no-headers 2>/dev/null | awk '$2 !~ /^([1-9][0-9]*)\/\1$/ {c++} END{print c+0}')"
  if [ "${term:-0}" -eq 0 ] && [ "${not_ready:-0}" -eq 0 ]; then
    break
  fi
  sleep 1
done

# Start load in the background.
bash "$ROOT/scripts/loadgen.sh" "$URL" "$RESULTS" "$CONCURRENCY" "$CONTROL" &
LOAD_PID=$!
# Brief settle so the counter is already moving when the rollout starts.
for _ in $(seq 1 50); do
  if ! kill -0 "$LOAD_PID" 2>/dev/null; then
    echo "loadgen exited early" >&2
    exit 1
  fi
  if [ "$(wc -l <"$RESULTS" | tr -d ' ')" -gt 10 ]; then
    break
  fi
  sleep 0.1
done
if [ "$(wc -l <"$RESULTS" | tr -d ' ')" -le 10 ]; then
  echo "loadgen produced too few samples before rollout" >&2
  exit 1
fi

NEW_REV="r-$(date +%s)"
START_TS="$(date +%s)"

case "$PROFILE" in
  correct)
    # Change pod-template annotation via Pulumi config → rolling update with maxUnavailable:0.
    (
      cd infra
      pulumi stack select dev
      pulumi config set rev "$NEW_REV" --plaintext
      pulumi up --yes --non-interactive
    )
    kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=180s
    ;;
  broken)
    # Intentionally bad: allow unavailable pods and strip readiness.
    kubectl -n "$NS" patch deploy "$DEPLOY" --type=strategic -p "{
      \"spec\": {
        \"strategy\": {\"rollingUpdate\": {\"maxUnavailable\": 1, \"maxSurge\": 0}},
        \"template\": {
          \"metadata\": {\"annotations\": {\"marketplace.io/rev\": \"$NEW_REV\"}},
          \"spec\": {
            \"terminationGracePeriodSeconds\": 1,
            \"containers\": [{
              \"name\": \"api\",
              \"readinessProbe\": null
            }]
          }
        }
      }
    }"
    kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=180s || true
    # Restore correct profile afterwards so the next run is clean.
    (
      cd infra
      pulumi stack select dev
      pulumi config set rev "restored-$NEW_REV" --plaintext
      pulumi up --yes --non-interactive
    ) || true
    ;;
  *)
    echo "unknown profile=$PROFILE" >&2
    exit 1
    ;;
esac

END_TS="$(date +%s)"
ROLLOUT_SECONDS=$((END_TS - START_TS))

# Keep load alive long enough to clear the 5000-request floor if the rollout was fast.
ELAPSED=$((END_TS - START_TS))
if [ "$ELAPSED" -lt "$MIN_SECONDS" ]; then
  sleep $((MIN_SECONDS - ELAPSED))
fi

# Stop the load generator and wait for workers to flush.
rm -f "$CONTROL"
wait "$LOAD_PID" 2>/dev/null || true
sleep 0.5

# Count from the file — never hard-code the verdict.
FAILED="$(awk 'BEGIN{f=0} $0!="200"{f++} END{print f}' "$RESULTS")"
OK="$(awk 'BEGIN{o=0} $0=="200"{o++} END{print o}' "$RESULTS")"
REQUESTS="$(awk 'END{print NR}' "$RESULTS")"

echo "profile=$PROFILE"
echo "requests=$REQUESTS"
echo "ok=$OK"
echo "failed=$FAILED"
echo "rollout-seconds=$ROLLOUT_SECONDS"

if [ "$PROFILE" = "correct" ] && [ "$FAILED" -ne 0 ]; then
  exit 1
fi
if [ "$PROFILE" = "correct" ] && [ "$REQUESTS" -lt 5000 ]; then
  echo "requests below 5000 — increase load window or concurrency" >&2
  exit 1
fi
exit 0
