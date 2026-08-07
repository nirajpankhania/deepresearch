# DeepResearch

An asynchronous research backend for scientific questions. A question is
submitted over HTTP and returns immediately with a task id; the answer is
produced out of band by a pipeline that plans sub-queries, retrieves sources via
Valyu, deduplicates and reranks them, synthesises a cited report, and verifies
each claim against the sources it cites.

Backend runs on Google Cloud (Cloud Run, Cloud Tasks, Firestore, Cloud Storage,
Vertex AI). Frontend is a Next.js app on Vercel.

> **Status: deployed and working end to end.** Submit a question at the URL
> below and it runs the full pipeline on real infrastructure — plan, retrieve
> under a spend cap, deduplicate, rerank, synthesise a cited report, then verify
> every claim against the source it cites. A typical task takes ~90 seconds and
> costs about $0.02 in retrieval.

## Documentation

| | |
|---|---|
| [`docs/design.md`](docs/design.md) | Architecture and the reasoning behind every choice |
| [`docs/example-output.md`](docs/example-output.md) | A complete task, verbatim: queries, sources, report, verdicts |
| [`docs/claim-grounding.md`](docs/claim-grounding.md) | The orchestration improvement, with before/after |
| [`docs/scaling.md`](docs/scaling.md) | 10× and 100× scaling, and orchestration techniques explored |
| [`docs/cost.md`](docs/cost.md) | Measured cost per task, fixed monthly cost, bottlenecks |

**Deployed**

| | |
|---|---|
| **Frontend** | **https://deepresearch-web.vercel.app** |
| API | `https://deepresearch-api-i5hdokk27q-nw.a.run.app` |
| Worker | `https://deepresearch-worker-i5hdokk27q-nw.a.run.app` (private — Cloud Tasks only) |

## Example API usage

The API requires an `X-API-Key` header. Retrieve the value with:

```bash
KEY=$(gcloud secrets versions access latest --secret=backend-api-key \
        --project=deepresearch-504612)
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

While running — `queries` and `sources` are written on completion, in the same
transaction as the report, so a task never reads as complete but reportless:

```jsonc
{
  "id": "5a6ce638-...", "status": "running", "attempt": 1,
  "progress": { "step": "retrieving", "message": "Searching 4 sub-queries", "pct": 30 },
  "queries": [], "sources": [],
  "cost": { "totalUsd": 0, "txIds": [] }
}
```

Progress runs `planning` 10 → `retrieving` 30 → `deduplicating` 55 →
`reranking` 70 → `synthesising` 85 → `grounding` 95 → `done` 100.

Once complete (abridged):

```jsonc
{
  "id": "5a6ce638-...", "status": "completed",
  "report": "Based on the provided sources, ... [1, 7]\n\n## Sources\n\n1. [...](...)",
  "queries": [
    { "query": "semaglutide body composition lean mass older adults",
      "includedSources": ["valyu/valyu-pubmed", "valyu/valyu-clinical-trials"],
      "rationale": "Trial outcomes are the primary evidence.",
      "resultCount": 10 }
  ],
  "sources": [
    { "id": "doi:10.1111/dom.70141", "title": "Impact of Semaglutide on fat mass...",
      "url": "https://pubmed.ncbi.nlm.nih.gov/PMC12673431",
      "dataset": "valyu/valyu-pubmed", "publicationDate": "2025-10-09",
      "authors": ["Mathieu Alissou", "Thomas Demangeat"],
      "doi": "10.1111/dom.70141", "pmcId": "PMC12673431",
      "relevanceScore": 0.92, "rerankScore": 1,
      "mergedAlternates": [{ "url": "...", "mergedBy": "doi" }] }
  ],
  // Measured from the search responses, never estimated. txIds are the audit trail.
  "cost": { "totalUsd": 0.03, "txIds": ["tx_3ecf41d4-...", "tx_444707b1-..."] },
  "grounding": {
    "mode": "per-claim", "supportedCount": 15, "totalCount": 20,
    "claims": [
      { "sentence": "...", "citedSourceIds": ["doi:10.1111/dom.70141"],
        "verdict": "supported" }
    ]
  }
}
```

A failed task carries `error` instead of `report`:

```jsonc
{ "status": "failed", "attempt": 3,
  "error": { "message": "Research failed after multiple attempts...", "stage": "planning" } }
```

Health check (no key required):

```bash
curl "$API/health"     # {"status":"ok","role":"api"}
```

## Frontend

Next.js App Router on Vercel, root directory `apps/web`.

### How the browser reaches the backend

It doesn't, directly. The browser calls this app's own route handlers
(`/api/tasks`, `/api/tasks/[task_id]`), which call Cloud Run server-side with
the `X-API-Key` header.

Two reasons. The shared key stays on the server — a browser calling Cloud Run
directly would need the key in the client bundle, which the brief forbids and
which no amount of obfuscation fixes. And the backend's CORS allowlist then only
has to admit the Vercel deployment rather than every visitor's origin.

`lib/backend.ts` imports `server-only`, so the build fails if that module is ever
reached from a client component instead of leaking the credential at runtime.
Verified on a production build: the key appears in **zero** served HTML documents
and **zero** client chunks.

### How the backend authenticates callers

`BACKEND_API_KEY` in an `X-API-Key` header, compared with a timing-safe
comparison. CORS is restricted to `ALLOWED_ORIGINS`, set at deploy time.

The endpoint is not left open because it is backed by paid search and model
calls: an open endpoint is a cost-exposure problem even though the research
results themselves are not confidential.

### Streaming, with polling as a real fallback

Server-sent events are the primary transport; polling every 2s (widening to 5s
after a minute) is the fallback.

**The Firestore listener lives on Cloud Run, not in the Vercel route handler.**
Watching Firestore needs Google credentials, and putting a service account key
in Vercel would add a third secret and the system's only long-lived key file.
Cloud Run already has that access through its own service account, so it holds
the listener and emits SSE; the Vercel handler adds the API key and pipes the
bytes through, keeping the credential server-side.

```
worker ──writes──► Firestore
                      │ onSnapshot (Cloud Run's own service account)
                      ▼
browser ◄──SSE── Vercel proxy ◄──SSE── Cloud Run  GET /tasks/:id/stream
      EventSource     (adds X-API-Key)
```

Vercel's function duration limit closes the connection before a long task
finishes, so reconnection was always required — `EventSource` reconnects on its
own, and because the backend replays current state on subscribe, a reconnect
resumes rather than losing progress. After three consecutive stream failures the
client drops to polling permanently for that task, so a proxy that strips event
streams costs smoothness rather than the feature.

### Configuring the backend URL

Two server-side environment variables, set in the Vercel dashboard **separately
for Preview and Production** so a preview deployment can be pointed at a
different backend without a code change:

| Variable | Value |
|---|---|
| `BACKEND_API_URL` | the Cloud Run API URL |
| `BACKEND_API_KEY` | from Secret Manager (`gcloud secrets versions access latest --secret=backend-api-key`) |

Neither is `NEXT_PUBLIC_`, which is what keeps them server-side. Locally they go
in `apps/web/.env.local`, which is gitignored.

### Deploying to Vercel

Import the repository at vercel.com/new with:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Build Command | `pnpm build` (ours builds `packages/shared` first) |
| Include files outside root | enabled — required for the workspace dependency |

Then redeploy the API with the Vercel domain so CORS admits it:

```bash
ALLOWED_ORIGINS=https://<project>.vercel.app scripts/deploy.sh api
```

### Domain features

Three, chosen because they make the retrieval legible rather than because they
look impressive — see [Who this is for](#who-this-is-for) below.

1. **Source cards** carrying dataset, publication date, authors, resolvable
   identifier (DOI, arXiv, PMID, PMC, NCT), relevance score, and any merged
   preprint/published alternate. This is what preserving Valyu's structured
   metadata is *for*.
2. **A "what was searched" panel** showing each generated sub-query, which
   corpora it targeted, its result count and rationale, plus the measured cost
   and how many results were merged as duplicates. Failed sub-queries are shown
   as failed, because a report built from three of four facets is a different
   object from one built from all four.
3. **A date-range control** wired to the search API's own bounds, so the budget
   is spent inside the window rather than on results that are then discarded.

Each of these fills in **while the task runs**, not after it. Sub-queries are
published as soon as the planner returns and tick off with their result counts
as each search lands; the selected sources appear before synthesis; and the
report streams in as it is written. A two-minute wait where nothing is visible
is the difference between a tool that feels broken and one that feels like it is
working.

**Cost breakdown.** Retrieval spend per sub-query and model spend per stage,
shown separately and labelled measured versus estimated — retrieval comes from
Valyu's own response and is exact, model cost is derived from reported token
counts against list prices. Reasoning tokens get their own column: they bill as
output, never appear in the response, and are routinely the largest line. On a
typical task model spend is over 3x retrieval spend, which a single total hides.

Citations in the report are links to the matching source card, so checking a
claim is one click rather than a scroll and a search.

Alongside these, the **claim check** panel surfaces the grounding verdicts: a
report-level "N of M cited claims are fully supported", and the specific
sentences that did not verify with the reason each failed. Weak claims are listed
first; supported ones are collapsed, because a reader checking a report cares
about the ones that did not verify. See
[`docs/claim-grounding.md`](docs/claim-grounding.md) for the before/after.

## Tests

```bash
pnpm test              # 200 unit tests — worker 172, api 17, web 11
scripts/smoke.sh       # 25 checks end-to-end against the deployed stack
```

Unit tests cover the logic where bugs are silent and correctness is checkable —
which is also the logic the brief grades:

| Area | What is tested |
|---|---|
| Identifiers | DOI/arXiv/PMID/PMC/NCT extraction and normalisation across the differing shapes Valyu returns |
| Deduplication | Identifier precedence, the title-and-author pass that catches preprint/published pairs, and chunk rejoining |
| Budget | The gate refusing before dispatch, and reservations holding under concurrency |
| Resilience | Retrying 5xx and 429, never other 4xx; timeout and backoff |
| Plan / rerank | Malformed responses, hallucinated dataset slugs, banned query operators |
| Citations | Stripping citations outside the corpus; linking them to source cards |
| Grounding | Sentence splitting across `2.4 mg`, `et al.`, `e.g.`, `Fig. 3`; unjudged claims defaulting to unsupported |

The smoke test runs against the deployed system and covers auth rejection,
request validation, the full lifecycle, retrieval quality (metadata preserved,
measured cost recorded, spend within cap), report quality (citations present and
all within the corpus, links absolute, grounding ran), both layers of idempotency
— duplicate enqueue rejected by the queue, redelivery leaving a completed task
untouched — and the failure path via forced failure.

---

## Layout

```
apps/api/        Cloud Run — HTTP handlers, task creation and retrieval
apps/worker/     Cloud Run — the research pipeline
  clients/         Valyu, Vertex AI — the only code that touches the network
  pipeline/        plan · retrieve · budget · dedup · rerank · synthesise · ground
apps/web/        Next.js — the interface, deployed to Vercel
packages/shared/ Types, the queue interface and the task repository, defined once
infra/           Terraform — queue, bucket, service accounts, IAM, secrets
scripts/         deploy.sh, smoke.sh, docker-entrypoint.sh
docs/            Design, cost, scaling, claim grounding, example output
Dockerfile       One image, ROLE=api|worker
```

Every file under `pipeline/` is data-in, data-out; only `clients/` performs I/O.
That boundary is what makes the logic the brief grades — deduplication, the
budget gate, plan validation — testable without mocking a single SDK.

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

`.env.example` documents every variable the services read and which service reads
each. The two secrets are `VALYU_API_KEY` and `BACKEND_API_KEY`; generate the
latter with `openssl rand -hex 32`.

The web app reads its own file, `apps/web/.env.local` — the backend URL and key
are server-side variables there, deliberately not `NEXT_PUBLIC_`:

```bash
cat > apps/web/.env.local <<'ENV'
BACKEND_API_URL=https://deepresearch-api-i5hdokk27q-nw.a.run.app
BACKEND_API_KEY=<from Secret Manager>
ENV
```

Run the three services, in separate terminals:

```bash
pnpm dev:api      # :8080
pnpm dev:worker   # :8081
pnpm dev:web      # :3000
```

With `DISPATCHER=local`, the API posts straight to the worker and skips Cloud
Tasks — the one component with no faithful local emulator, kept behind a
one-method interface for exactly that reason. Firestore is the real thing in both
local and deployed environments, so the claim transaction and lease behaviour
never diverge.

Requires Application Default Credentials (`gcloud auth application-default
login`) for Firestore and Vertex AI.

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
terraform -chdir=infra init
terraform -chdir=infra apply        # queue, bucket, service accounts, IAM, secrets

scripts/deploy.sh worker            # worker first — the API needs its URL
scripts/deploy.sh api
scripts/deploy.sh all               # or both, in order
```

Terraform manages the Cloud Tasks queue, the traces bucket, three service
accounts, their IAM bindings, and the `backend-api-key` secret *container*. It
never manages a secret **value** — that would put the value in local state — so
both are added out of band:

```bash
printf '%s' "$(openssl rand -hex 32)" | \
  gcloud secrets versions add backend-api-key --data-file=-

printf '%s' "$VALYU_KEY" | \
  gcloud secrets versions add valyu-api-key --data-file=-
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

- **The interface has not been reviewed in a browser at every breakpoint.**
  It is deployed and verified end to end by driving its own route handlers, but
  visual polish across viewport sizes is the least-tested surface.
- **Grounding uses the same model family that wrote the report**, so shared blind
  spots are possible. It also judges against the extracted snippet rather than
  the full document, which is the main source of false negatives.
- **No evaluation harness.** Claim grounding measures faithfulness to the
  retrieved sources, which is checkable; it does not measure correctness, which
  would need a labelled question set.
- **Terraform state is local**, which is fine for a single operator and wrong for
  a team. A shared setup wants a GCS backend with state locking.
- **The API runs `min-instances=1`** to avoid cold starts during review. That
  bills continuously and should be 0 outside a review window.
- **Orphaned tasks are corrected on read, not on a schedule.** A task whose
  worker died on every delivery is marked failed the next time someone fetches
  it; one never fetched again stays `running` in Firestore. Harmless, but a
  sweeper would be tidier.
- **`BACKEND_API_KEY` is shared, not per-user.** There is no multi-user auth and
  no per-caller rate limiting; the key bounds cost exposure, not abuse by a
  legitimate holder.
- **`gemini-2.5-pro` retires 16 October 2026.** Used for synthesis because no
  Gemini 3 Pro is available on this project. Both model IDs are environment
  variables, so the swap is a redeploy.

Deliberately out of scope, with the alternative noted:

- **Multi-user auth** — would need per-user quotas and task ownership, which is a
  different product.
- **A real eval harness** — the honest version needs a labelled question set;
  claim grounding is the tractable subset.
- **GPU inference** — no reason to when Vertex AI serves the models.
- **Cloud Build CI triggers** — deployment is a script; a team would want the
  trigger plus a staging environment.
- **Adaptive follow-up searches and contradiction checks** — both are real
  improvements, both discussed in the Task 3 writeup rather than built.

---

## Submission

**Deployed frontend** · https://deepresearch-web.vercel.app
**Deployed backend** · `https://deepresearch-api-i5hdokk27q-nw.a.run.app`

The frontend needs no credentials — it holds the API key server-side. The
commands below call the backend directly, which does.

**Credentials.** The API requires `BACKEND_API_KEY` in an `X-API-Key` header.
It is a self-issued token, not the Valyu key, and exists to stop an open endpoint
spending against paid search and model APIs. Retrieve it with:

```bash
gcloud secrets versions access latest --secret=backend-api-key --project=deepresearch-504612
```

It should be rotated after review, since sharing it makes it no longer secret:

```bash
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets versions add backend-api-key --data-file=-
scripts/deploy.sh api    # picks up :latest
```

The Valyu key is not in this repository, is readable only by the worker's service
account, and never reaches the browser or the logs.

### Create a task and retrieve the result

```bash
KEY=$(gcloud secrets versions access latest --secret=backend-api-key --project=deepresearch-504612)
API=https://deepresearch-api-i5hdokk27q-nw.a.run.app

# Create — returns immediately
TASK=$(curl -s -X POST "$API/tasks" \
  -H 'Content-Type: application/json' -H "X-API-Key: $KEY" \
  -d '{"question":"Does semaglutide preserve lean muscle mass in older adults during weight loss?"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "$TASK"

# Poll until complete — typically 90 seconds
until [ "$(curl -s "$API/tasks/$TASK" -H "X-API-Key: $KEY" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')" = completed ]; do sleep 5; done

# Read the report
curl -s "$API/tasks/$TASK" -H "X-API-Key: $KEY" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["report"])'
```

To see the failure path, submit a question containing `__FORCE_FAILURE__`. It
retries three times and lands in `failed` with a readable error.
