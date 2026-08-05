#!/usr/bin/env bash
# Deploy both Cloud Run services from the single image.
#
# Cloud Run is deployed here rather than in Terraform so that Terraform never
# needs to know an image digest — otherwise every code change becomes a state
# change. Terraform owns the static infrastructure; this script owns the
# services and the one IAM binding that depends on them existing.
#
# Order matters: the worker is deployed first because the API needs its URL, and
# the run.invoker binding needs the service to exist.
#
# Usage:  scripts/deploy.sh [worker|api|all]
set -euo pipefail

TARGET="${1:-all}"

PROJECT="${GCP_PROJECT_ID:-deepresearch-504612}"
REGION="${GCP_REGION:-europe-west2}"
API_SERVICE="deepresearch-api"
WORKER_SERVICE="deepresearch-worker"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Must match the queue's retry_config and the worker's lease. This value is the
# per-task maximum runtime requirement, enforced by the platform rather than by
# application code that could fail to enforce it.
WORKER_TIMEOUT=900

cd "$REPO_ROOT"

tf_output() {
  terraform -chdir=infra output -raw "$1"
}

echo "==> Reading Terraform outputs"
API_SA="$(tf_output api_service_account)"
WORKER_SA="$(tf_output worker_service_account)"
INVOKER_SA="$(tf_output tasks_invoker_service_account)"
QUEUE_NAME="$(tf_output queue_name)"
TRACE_BUCKET="$(tf_output trace_bucket)"

# Set at deploy time rather than baked in: the Vercel domain is not known until
# the frontend is deployed, and changing it should not require a rebuild.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:3000}"

deploy_worker() {
  echo "==> Deploying $WORKER_SERVICE"
  gcloud run deploy "$WORKER_SERVICE" \
    --source . \
    --project "$PROJECT" \
    --region "$REGION" \
    --service-account "$WORKER_SA" \
    --no-allow-unauthenticated \
    --concurrency 1 \
    --cpu 1 \
    --memory 1Gi \
    --max-instances 5 \
    --timeout "${WORKER_TIMEOUT}s" \
    --set-env-vars "ROLE=worker,GCP_PROJECT_ID=$PROJECT,GCP_REGION=$REGION,GCS_TRACE_BUCKET=$TRACE_BUCKET,GEMINI_FLASH_MODEL=gemini-3-flash-preview,GEMINI_PRO_MODEL=gemini-2.5-pro,LEASE_SECONDS=$WORKER_TIMEOUT" \
    --set-secrets "VALYU_API_KEY=valyu-api-key:latest" \
    --quiet

  WORKER_URL="$(gcloud run services describe "$WORKER_SERVICE" \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
  echo "    worker URL: $WORKER_URL"

  # The binding Terraform cannot own, because it targets a service Terraform
  # does not manage. Granting only the Cloud Tasks invoker means the worker is
  # reachable through the queue and by nothing else -- not even the API.
  echo "==> Granting run.invoker to $INVOKER_SA"
  gcloud run services add-iam-policy-binding "$WORKER_SERVICE" \
    --project "$PROJECT" --region "$REGION" \
    --member "serviceAccount:$INVOKER_SA" \
    --role roles/run.invoker \
    --quiet >/dev/null
}

deploy_api() {
  if [[ -z "${WORKER_URL:-}" ]]; then
    WORKER_URL="$(gcloud run services describe "$WORKER_SERVICE" \
      --project "$PROJECT" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
  fi
  if [[ -z "$WORKER_URL" ]]; then
    echo "ERROR: worker service not found. Deploy the worker first." >&2
    exit 1
  fi

  echo "==> Deploying $API_SERVICE"
  # Public, because the Vercel route handler calls it from outside GCP. The
  # X-API-Key check is what actually protects it; see docs/design.md.
  gcloud run deploy "$API_SERVICE" \
    --source . \
    --project "$PROJECT" \
    --region "$REGION" \
    --service-account "$API_SA" \
    --allow-unauthenticated \
    --concurrency 80 \
    --cpu 1 \
    --memory 512Mi \
    --min-instances 1 \
    --max-instances 10 \
    --timeout 60s \
    --set-env-vars "ROLE=api,GCP_PROJECT_ID=$PROJECT,GCP_REGION=$REGION,DISPATCHER=cloudtasks,TASKS_QUEUE=$QUEUE_NAME,WORKER_URL=$WORKER_URL,TASKS_INVOKER_SA=$INVOKER_SA,ALLOWED_ORIGINS=$ALLOWED_ORIGINS" \
    --set-secrets "BACKEND_API_KEY=backend-api-key:latest" \
    --quiet

  API_URL="$(gcloud run services describe "$API_SERVICE" \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
  echo "    api URL: $API_URL"
}

case "$TARGET" in
  worker) deploy_worker ;;
  api)    deploy_api ;;
  all)    deploy_worker; deploy_api ;;
  *)      echo "Usage: $0 [worker|api|all]" >&2; exit 1 ;;
esac

echo "==> Done"
