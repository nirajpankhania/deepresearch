# DeepResearch — design record

The decisions behind the implementation, and the reasoning for each. The README
covers setup and usage; this document covers *why*.

---

## 1. Problem shape

A research question arrives over HTTP and takes minutes to answer: several
retrieval calls against Valyu, a synthesis pass over a language model, and a
verification pass over the result. Three properties follow directly and drive
everything below.

**The work outlives the request.** A question cannot be answered inside an HTTP
timeout, so submission and execution must be separate. `POST /tasks` records the
question and returns an identifier; the answer is collected later.

**The work is expensive and repeatable.** Every attempt spends money on paid
search and model calls. Retries therefore have to be bounded, and a retried
message must not re-run work that already succeeded.

**The work fails in parts.** One search returning a 502 should not lose the
other four. Partial failure is the normal case, not an exceptional one.

---

## 2. Architecture

```
Browser
   │  (never holds a credential)
   ▼
Next.js route handler (Vercel)
   │  X-API-Key: BACKEND_API_KEY
   ▼
Cloud Run: API ──────────────► Firestore  (task state, report)
   │
   │  enqueue task-{taskId}
   ▼
Cloud Tasks  (retry policy, duplicate rejection, OIDC push)
   │
   ▼
Cloud Run: worker ───────────► Vertex AI (Gemini)
                   ├─────────► Valyu /v1/search
                   └─────────► Cloud Storage (retrieval traces)
```

### Why these services

**Cloud Run, two services, one image.** The API and the worker have genuinely
different shapes — one is latency-sensitive and public, the other is long-running
and private — so they need separate scaling and separate identities. They do not
need separate images: they share types, the Firestore client and the logging
setup, and they always deploy from the same commit. One `Dockerfile` with
`ROLE=api|worker` gives the separation that matters without two builds that can
drift.

**Cloud Tasks, not Pub/Sub.** This is per-task dispatch, not fan-out, so Pub/Sub's
delivery semantics buy nothing. Cloud Tasks brings three things that would
otherwise be application code: named tasks (`task-{taskId}`) make a duplicate
enqueue a service-level rejection rather than a second run; the retry policy is
queue configuration rather than a loop someone has to get right; and OIDC push
authentication means the worker requires an authenticated invoker and is never
publicly reachable.

**Firestore.** Task state has to survive process restarts, and the document model
fits the task shape without an ORM. The deciding factor against Cloud SQL was the
VPC connector it would require — a serverless VPC connector is a fixed monthly
cost and an extra failure domain, for a workload with no relational queries.

**Cloud Storage for traces.** Raw Valyu responses are far too large for a
Firestore document but are exactly what makes the retrieval strategy auditable.
They are also the "example output" deliverable.

**Vertex AI / Gemini.** The worker's service account authenticates directly, so
there is no model-provider API key anywhere in the system. This is the single
biggest simplification in the design: it takes the secret inventory from three
entries to two, and it keeps model spend on the same invoice as everything else.

**Terraform for static infra only.** The queue, bucket, service accounts, IAM
bindings and secret containers are declared; Cloud Run is deployed from source by
a script. Putting Cloud Run in Terraform means Terraform needs an image digest,
which turns every code iteration into a state change.

---

## 3. Secrets

Two, total.

| | Where it lives | Who can read it |
|---|---|---|
| `VALYU_API_KEY` | Secret Manager → worker | worker service account only |
| `BACKEND_API_KEY` | Secret Manager → API, and Vercel server env | API service account, Vercel server runtime |

`VALYU_API_KEY` is the only third-party credential in the system. `BACKEND_API_KEY`
is self-issued, and exists because an open endpoint backed by paid search and
model calls is a cost-exposure problem rather than a data-privacy one — the
research results are not confidential, but the ability to spend against the key
is.

Neither reaches the browser. The frontend calls its own Next.js route handlers,
which hold the key server-side; no `NEXT_PUBLIC_` variable carries a credential.

The API cannot read the Valyu key and has no Vertex AI permission. A compromised
API service can enqueue work, and nothing else.

---

## 4. Idempotency

The requirement is that a retried queue message must not produce a duplicate
final result. The mechanism is a lease, claimed in a Firestore transaction.

A worker claims a task only if:

- `status === 'queued'`, or
- `status === 'running'` **and** `leaseExpiresAt < now` — the previous attempt
  died without writing a terminal state.

If the task is already `completed` or `failed`, the worker returns **200
immediately and does no work**. This is the case that matters: returning an error
would make Cloud Tasks retry the message it is trying to stop sending.

The final report write and the flip to `completed` happen in a single
transaction, so there is no window in which a task is complete but reportless.

Two layers back this up. Cloud Tasks rejects a duplicate enqueue of
`task-{taskId}` before it ever reaches the worker, and the worker's Cloud Run
timeout (900s) is the same value as the lease, so a lease cannot lapse while its
holder is still running.

---

## 5. Retrieval

The brief singles out `search(question)` with no parameters as inadequate, and it
is: Valyu's own guidance is that complex research should be split into targeted
sub-queries, and its query syntax rejects `site:`, `AND`, `OR` and quoting, so
there is no operator-based route to precision either. Precision has to come from
decomposition and source routing.

**Plan.** One Flash call produces 3-5 sub-queries as strict JSON. Two rules the
prompt enforces: decompose by *facet* rather than by rephrasing, and route
sources by question type — clinical questions to PubMed and clinical trials,
ML questions to arXiv and web, and so on.

**Retrieve.** Sub-queries run in parallel under `Promise.allSettled`, so one
failure costs one facet rather than the task. Each call gets a 20s timeout and
two retries, on 5xx and network errors only — retrying a 4xx just spends the same
money to get the same answer.

**Budget.** Valyu reports `total_deduction_dollars` and `tx_id` per response.
Both are accumulated, and the `$0.30` per-task cap is checked *before* dispatching
each call rather than after. The stored cost is measured, never estimated, and
the `tx_id` list is the audit trail.

**Dedup.** Identifier precedence DOI → arXiv ID → PMID → normalised URL, then a
second pass on normalised title plus first author. The second pass is the one
that earns its place: a preprint and its published version have *different* DOIs,
so identifier matching alone reports them as two sources. The lower-relevance
copy is retained as a `mergedAlternate` rather than discarded, because which
version was found is itself informative.

**Rerank.** Valyu scores relevance per sub-query, so a source that ranked highly
for a narrow facet may be marginal to the question actually asked. One Flash call
re-scores the merged corpus against the original question before it is capped at
~20 sources.

**Synthesise.** One Pro-tier call over numbered sources with full metadata. The
prompt instructs the model to omit claims it cannot ground in the provided
sources rather than filling gaps from parametric knowledge.

**Ground.** Citation-bearing sentences are classified `supported` / `partial` /
`unsupported` against the sources they cite, in one batched Flash call. The
verdicts are surfaced, not acted on: rewriting unsupported claims means a second
synthesis pass, which doubles the failure surface and can introduce new
ungrounded text. Showing the reader which claims are weak is more honest than
silently rewriting them.

### Source availability

Valyu's source access is tiered, and this key is limited. arXiv, PubMed and web
are the reliable core; patents, genomics and finance are best-effort with
graceful degradation. `GET /v1/datasources` is called once during development and
the result recorded, so an unavailable source is a documented design constraint
rather than a runtime surprise.

---

## 6. Development environment

**Queue behind an interface.** `TaskDispatcher` has one method. Production uses
`CloudTasksDispatcher`; local development uses `LocalHttpDispatcher`, which POSTs
straight to the worker. This is the only component that differs between
environments, and it is deliberately the smallest possible surface — Cloud Tasks
has no faithful local emulator, and the third-party ones diverge precisely on the
transaction and OIDC semantics that matter.

Everything downstream of the queue runs against **real Firestore** in both
environments, so the claim transaction and the lease are never mocked and never
diverge.

**Testing.** Unit tests cover the pure logic where bugs are silent: dedup key
precedence, the title-and-author second pass, the budget gate firing before
dispatch, plan-JSON validation, citation-sentence mapping. Adapter tests replay
recorded Valyu and Gemini responses. One smoke script exercises the deployed
stack end to end. The pipeline is written as data-in/data-out functions with
network access confined to `clients/`, which is what makes this cheap — there is
no Firestore or SDK mocking needed to reach the logic being tested.

---

## 7. Frontend

**Polling, not SSE.** The frontend polls every 2s while a task is running, backs
off to 5s after 60s, and stops on a terminal state. SSE across two clouds means
holding a connection open through a Vercel function, which has its own timeout and
degrades badly; polling degrades gracefully, survives a dropped connection, and
costs a request every two seconds. For a task measured in minutes that is the
right trade.

**Three domain features**, chosen because they make the retrieval strategy
legible rather than because they are visually impressive:

1. **Rich source cards** — source type, publication date, authors, identifier,
   relevance score and merged preprint/journal alternates. This is where
   preserving Valyu's structured metadata pays off visibly.
2. **A "what was searched" panel** — the generated sub-queries, the sources each
   targeted, result counts and measured cost.
3. **Date-range control**, wired to Valyu's `start_date` / `end_date`.

Plus the grounding verdicts: a per-claim indicator and a report-level "N of M
claims verified".

---

## 8. Build order

Each phase runs before the next begins.

| Phase | Content |
|---|---|
| 0 | Scaffold: workspace, shared types, Dockerfile, Terraform. Verify Gemini model IDs and Valyu source access. |
| 1 | Walking skeleton — full lifecycle on real infrastructure with a hardcoded report. |
| 2 | Retrieval: plan, retrieve, budget, dedup, rerank. |
| 3 | Synthesis and citation rendering. |
| 4 | Frontend, deployed to Vercel. |
| 5 | Claim grounding. |
| 6 | Documentation, example output, smoke tests, then visual design. |

Phase 1 is the important one. Proving the full lifecycle — enqueue, claim,
transaction, terminal write — against real infrastructure *before* any
intelligence exists means every later failure is a pipeline failure, and the
infrastructure is never a suspect.
