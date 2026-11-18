#!/usr/bin/env bash
set -euo pipefail
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be configured in GitHub Actions Secrets}"
: "${PULUMI_CONFIG_PASSPHRASE:?PULUMI_CONFIG_PASSPHRASE must be configured in GitHub Actions Secrets}"
ROOT="$PWD"
mkdir -p "$ROOT/.pulumi"
export PULUMI_BACKEND_URL="file://$ROOT/.pulumi"
export SCAN_IMAGE="$IMAGE_REPOSITORY@$BUILT_DIGEST"
docker pull "$SCAN_IMAGE"
docker tag "$SCAN_IMAGE" marketplace-api:ci
SCAN_IMAGE=marketplace-api:ci npm run cluster:up
# Import by immutable registry manifest too: Docker-save can change manifest media types.
# Package must be public; this also checks anonymous registry access for the grader.
docker exec hw28-control-plane ctr --namespace k8s.io images pull "$SCAN_IMAGE"
# Fresh runner state: never reuse a developer's encrypted stack settings.
rm -f infra/Pulumi.dev.yaml
pulumi login "$PULUMI_BACKEND_URL" >/dev/null
(cd infra; pulumi stack init dev; pulumi config set image "$SCAN_IMAGE" --plaintext)
# Preview the actual PR base with the same configuration. Both previews see an empty stack.
cp infra/index.ts /tmp/head-infra.ts
trap 'cp /tmp/head-infra.ts infra/index.ts' EXIT
git show "$BASE_SHA:infra/index.ts" > infra/index.ts
(cd infra; APP_DB_PASSWORD=ci-preview-placeholder pulumi preview --json --non-interactive) > evidence/base-plan.json
cp /tmp/head-infra.ts infra/index.ts
(cd infra; APP_DB_PASSWORD=ci-preview-placeholder pulumi preview --json --non-interactive) > evidence/plan.json
PLAN_JSON="$ROOT/evidence/plan.json" BASE_PLAN_JSON="$ROOT/evidence/base-plan.json" COST_BUDGET_USD=10 npm run gate:cost
npm run up
kubectl -n marketplace get deploy marketplace-api -o json > evidence/deployment.json
node scripts/deployment-evidence.mjs
# Same HW28 rollout: it forces a new pod revision through pulumi up.
set +e
npm run demo:rollout | tee evidence/rollout.txt
rollout_exit=${PIPESTATUS[0]}
set -e
node scripts/rollout-evidence.mjs
exit "$rollout_exit"
