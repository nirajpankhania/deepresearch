# DeepResearch

An asynchronous research backend for scientific questions. A question is
submitted over HTTP and returns immediately with a task id; the answer is
produced out of band by a pipeline that plans sub-queries, retrieves sources via
Valyu, deduplicates and reranks them, synthesises a cited report, and verifies
each claim against the sources it cites.

Backend runs on Google Cloud (Cloud Run, Cloud Tasks, Firestore, Cloud Storage,
Vertex AI). Frontend is a Next.js app on Vercel.

> **Status: Phase 1 complete.** The full task lifecycle runs on real
> infrastructure — submit, queue, claim, complete — with idempotent retry
> handling verified end to end. The report itself is still a placeholder; the
> retrieval pipeline lands in Phase 2. See [`docs/design.md`](docs/design.md)
> for the design and rationale.

**Deployed backend**

| | |
|---|---|
| API | `https://deepresearch-api-i5hdokk27q-nw.a.run.app` |
| Worker | `https://deepresearch-worker-i5hdokk27q-nw.a.run.app` (private — Cloud Tasks only) |

## Example API usage

The API requires an `X-API-Key` header. Retrieve the value with:

```bash
KEY=$(gcloud secrets versions access latest --secret=backend-api-key)
API=https://deepresearch-api-i5hdokk27q-nw.a.run.app
```

Create a task — returns immediately with an id:

```bash
curl -X POST "$API/tasks" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $KEY" \
  -d '{
        "question": "Does semaglutide preserve muscle mass in older adults?",
        "dateRange": { "start": "2020-01-01" }
      }'

# 202  {"id":"5a6ce638-f9de-47cd-8140-f5e942b9b0a1","status":"queued"}
```

Retrieve it — status, progress, and the report once complete:

```bash
curl "$API/tasks/5a6ce638-f9de-47cd-8140-f5e942b9b0a1" -H "X-API-Key: $KEY"
```

```jsonc
{
  "id": "5a6ce638-...", "status": "running",
  "progress": { "step": "retrieving", "message": "Searching sources", "pct": 50 },
  "attempt": 1, "queries": [], "sources": [],
  "cost": { "totalUsd": 0, "txIds": [] }
}
```

Health check (no key required):

```bash
curl "$API/health"     # {"status":"ok","role":"api"}
```

## Tests

```bash
pnpm test              # unit tests
scripts/smoke.sh       # end-to-end against the deployed stack
```

The smoke test covers auth rejection, request validation, the full lifecycle,
and both layers of idempotency — that a duplicate enqueue is rejected by the
queue, and that a redelivered message leaves a completed task untouched.

---

## Layout

```
apps/api/        Cloud Run — HTTP handlers, task creation and retrieval
apps/worker/     Cloud Run — the research pipeline
apps/web/        Next.js — deployed to Vercel                      (Phase 4)
packages/shared/ Types and the queue interface, defined once
infra/           Terraform — queue, bucket, service accounts, IAM, secrets
scripts/         Deploy and smoke-test scripts
Dockerfile       One image, ROLE=api|worker
```

## Requirements

- Node 22+ and pnpm 9
- Docker (for building the container)
- Terraform 1.9+
- gcloud CLI, authenticated against the target project

## Local setup

```bash
pnpm install
cp .env.example .env      # then fill in the blanks
pnpm build
```

`.env.example` documents every variable and which service reads it. The two
secrets are `VALYU_API_KEY` and `BACKEND_API_KEY`; generate the latter with
`openssl rand -hex 32`.

Run the services locally, in two terminals:

```bash
pnpm dev:api      # :8080
pnpm dev:worker   # :8081
```

With `DISPATCHER=local`, the API posts straight to the worker and skips Cloud
Tasks. Firestore is the real thing in both local and deployed environments, so
the claim transaction and lease behaviour never diverge.

## Infrastructure

```bash
terraform -chdir=infra init
terraform -chdir=infra apply
```

Terraform manages the Cloud Tasks queue, the traces bucket, three service
accounts, their IAM bindings, and the `backend-api-key` secret *container*. It
never manages a secret value — those are added out of band:

```bash
printf '%s' "$(openssl rand -hex 32)" | \
  gcloud secrets versions add backend-api-key --data-file=-
```

Cloud Run is deployed by script rather than Terraform, so that Terraform never
needs to know an image digest.

## Container

```bash
docker build -t deepresearch .
docker run --rm -p 8080:8080 --env-file .env -e ROLE=api    deepresearch
docker run --rm -p 8081:8080 --env-file .env -e ROLE=worker deepresearch
```

## Deployment

Static infrastructure is Terraform; the services are a script. Cloud Run is not
in Terraform so that Terraform never needs to know an image digest — otherwise
every code change becomes a state change.

```bash
terraform -chdir=infra apply        # queue, bucket, service accounts, IAM, secrets

scripts/deploy.sh worker            # worker first — the API needs its URL
scripts/deploy.sh api
scripts/deploy.sh all               # or both, in order
```

`deploy.sh` builds the image with Cloud Build from source, deploys both
services, and grants `roles/run.invoker` on the worker to the Cloud Tasks
invoker service account. That binding lives here rather than in Terraform
because it targets a service Terraform does not manage.

Deploy-time overrides:

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowlist; set to the Vercel domain |
| `FAULT_INJECTION_ENABLED` | `true` | Lets `__FORCE_FAILURE__` in a question fail on purpose |

### Fault injection

A question containing `__FORCE_FAILURE__` fails deliberately, exhausting its
retries and landing in `failed` with a readable error. It is enabled on the
deployed worker because the failure path is otherwise only reachable during a
real outage, and both the smoke test and the frontend's failed state need
something that fails on demand. It sits behind the same API key as every other
endpoint. Deploy with `FAULT_INJECTION_ENABLED=false` to switch it off.

## Who this is for

The user I had in mind is a researcher or analyst doing a literature scan on an
unfamiliar question — someone who knows their field well enough to distrust a
confident summary, and whose next move after reading one is to go and check it.

That assumption drives the feature choices. A research tool that produces a
fluent report and hides its working is worse than useless to this person,
because verifying it costs more than doing the search themselves. So the design
spends its effort on making the machinery inspectable: rich source cards showing
publication date, authors, identifier and relevance rather than a bare link; a
panel exposing the sub-queries the system actually generated, which sources each
targeted and what it cost; and per-claim grounding verdicts that mark which
sentences the cited sources genuinely support. A date-range control is there
because currency is often the whole question in fast-moving fields.

The common thread is that each feature answers "why should I believe this?" —
which is the question that decides whether a tool like this gets used twice.

## Known limitations

Current, and honest.

- **The retrieval pipeline is not built yet.** Reports are placeholder text; the
  planning, retrieval, dedup, rerank and synthesis stages land in Phase 2-3.
- **The frontend is a shell.** Deployed to prove the workspace build; the real
  interface is Phase 4.
- **Terraform state is local**, which is fine for a single operator and wrong for
  a team. A shared setup wants a GCS backend with state locking.
- **The API runs `min-instances=1`** to avoid cold starts during review. That
  bills continuously and should be 0 outside a review window.
- **`BACKEND_API_KEY` is shared, not per-user.** There is no multi-user auth and
  no per-caller rate limiting; the key bounds cost exposure, not abuse by a
  legitimate holder.
- **`gemini-2.5-pro` retires 16 October 2026.** Used for synthesis because no
  Gemini 3 Pro is available on this project. Both model IDs are environment
  variables, so the swap is a redeploy.

Deliberately out of scope, with the alternative noted:

- **SSE/streaming** — polling is simpler across two clouds and degrades better;
  streaming would want the report generated incrementally to be worth it.
- **Multi-user auth** — would need per-user quotas and task ownership, which is a
  different product.
- **A real eval harness** — the honest version needs a labelled question set;
  claim grounding is the tractable subset.
- **GPU inference** — no reason to when Vertex AI serves the models.
- **Cloud Build CI triggers** — deployment is a script; a team would want the
  trigger plus a staging environment.
- **Adaptive follow-up searches and contradiction checks** — both are real
  improvements, both discussed in the Task 3 writeup rather than built.
