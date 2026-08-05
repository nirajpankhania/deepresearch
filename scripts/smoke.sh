#!/usr/bin/env bash
# End-to-end smoke test against the deployed stack.
#
# Covers the lifecycle and the two properties that are easy to get wrong and
# invisible in normal use: auth rejection, and idempotent handling of a retried
# queue message.
#
# Usage:  scripts/smoke.sh [api-url]
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:-deepresearch-504612}"
REGION="${GCP_REGION:-europe-west2}"
QUEUE="${TASKS_QUEUE:-research-tasks}"
API_SERVICE="deepresearch-api"
WORKER_SERVICE="deepresearch-worker"

# This WSL image ships curl 7.81, which fails HTTP/2 negotiation against some
# hosts with PROTOCOL_ERROR. Pinning 1.1 costs nothing and avoids a false red.
CURL=(curl -s --http1.1 --max-time 60)

PASS=0
FAIL=0
check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "  PASS  $1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $1 (got '$2', want '$3')"
    FAIL=$((FAIL + 1))
  fi
}

API="${1:-$(gcloud run services describe "$API_SERVICE" \
  --project "$PROJECT" --region "$REGION" --format='value(status.url)')}"
WORKER="$(gcloud run services describe "$WORKER_SERVICE" \
  --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
INVOKER="$(terraform -chdir="$(dirname "${BASH_SOURCE[0]}")/../infra" output -raw tasks_invoker_service_account)"
KEY="$(gcloud secrets versions access latest --secret=backend-api-key --project="$PROJECT")"

echo "API:    $API"
echo "Worker: $WORKER"
echo

code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }

echo "Health and auth"
check "GET /health is 200" \
  "$(code "$API/health")" "200"
check "POST /tasks without a key is 401" \
  "$(code -X POST -H 'Content-Type: application/json' -d '{"question":"a question long enough"}' "$API/tasks")" "401"
check "POST /tasks with a bad key is 401" \
  "$(code -X POST -H 'Content-Type: application/json' -H 'X-API-Key: wrong' -d '{"question":"a question long enough"}' "$API/tasks")" "401"
check "GET unknown task is 404" \
  "$(code -H "X-API-Key: $KEY" "$API/tasks/does-not-exist")" "404"

echo
echo "Validation"
check "empty question is 400" \
  "$(code -X POST -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d '{}' "$API/tasks")" "400"
check "short question is 400" \
  "$(code -X POST -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d '{"question":"hi"}' "$API/tasks")" "400"
check "inverted date range is 400" \
  "$(code -X POST -H 'Content-Type: application/json' -H "X-API-Key: $KEY" -d '{"question":"a question long enough","dateRange":{"start":"2024-01-01","end":"2020-01-01"}}' "$API/tasks")" "400"

echo
echo "Lifecycle"
RESP="$("${CURL[@]}" -X POST -H 'Content-Type: application/json' -H "X-API-Key: $KEY" \
  -d '{"question":"Does semaglutide preserve muscle mass in older adults?"}' "$API/tasks")"
TASK_ID="$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
echo "  task: $TASK_ID"

STATUS=""
for _ in $(seq 1 90); do
  STATUS="$("${CURL[@]}" -H "X-API-Key: $KEY" "$API/tasks/$TASK_ID" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
  sleep 2
done
check "task reaches completed" "$STATUS" "completed"

HAS_REPORT="$("${CURL[@]}" -H "X-API-Key: $KEY" "$API/tasks/$TASK_ID" \
  | python3 -c 'import sys,json;print("yes" if (json.load(sys.stdin).get("report") or "").strip() else "no")')"
check "completed task has a report" "$HAS_REPORT" "yes"

echo
echo "Idempotency"
BEFORE="$("${CURL[@]}" -H "X-API-Key: $KEY" "$API/tasks/$TASK_ID")"

# Layer 1: the queue itself rejects a second task with the same name.
DUP="$(gcloud tasks create-http-task "task-$TASK_ID" --queue="$QUEUE" --location="$REGION" \
  --project="$PROJECT" --url="$WORKER/process" --method=POST \
  --header="Content-Type: application/json" --body-content="{\"taskId\":\"$TASK_ID\"}" \
  --oidc-service-account-email="$INVOKER" --oidc-token-audience="$WORKER" 2>&1 || true)"
check "duplicate enqueue is rejected" \
  "$(grep -q 'ALREADY_EXISTS' <<<"$DUP" && echo yes || echo no)" "yes"

# Layer 2: even if a message does reach the worker again, it must be a no-op.
gcloud tasks create-http-task "redelivery-probe-$(date +%s)" --queue="$QUEUE" --location="$REGION" \
  --project="$PROJECT" --url="$WORKER/process" --method=POST \
  --header="Content-Type: application/json" --body-content="{\"taskId\":\"$TASK_ID\"}" \
  --oidc-service-account-email="$INVOKER" --oidc-token-audience="$WORKER" >/dev/null 2>&1
sleep 12
AFTER="$("${CURL[@]}" -H "X-API-Key: $KEY" "$API/tasks/$TASK_ID")"
check "redelivery leaves the task unchanged" \
  "$(if [[ "$BEFORE" == "$AFTER" ]]; then echo same; else echo mutated; fi)" "same"

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
