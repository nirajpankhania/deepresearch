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

### The task nobody finishes

The lease recovers an attempt that died, because the next delivery reclaims it.
It does not recover a task where *every* delivery died — the container is killed
before it can write anything, so the catch block that would mark a failure never
runs. Cloud Tasks eventually exhausts its attempts and stops, and the document is
left `running` with a lapsed lease and nothing to reclaim it. A polling client
waits forever.

Tasks are therefore reaped on read: a `running` task whose lease lapsed more than
an hour ago is marked `failed`, transactionally, with an error saying what
happened. An hour because the grace period must exceed the window in which a
retry could still legitimately arrive — `maxRetryDuration` plus the longest
backoff, about 3000s. Reaping too eagerly is the worse error: it writes a
terminal state, and a delivery arriving afterwards would correctly treat that as
"already finished" and no-op, turning a recoverable task into a dead one.

On read rather than on a schedule, because a sweeper needs Cloud Scheduler,
another service account and another endpoint to secure, and reading is the only
moment anyone is waiting on the answer.

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

**Rerank.** Valyu scores relevance per sub-query, so after merging five
sub-queries the scores are five incommensurable scales. One Flash call re-judges
the merged corpus against the original question.

It asks for three judgements per source rather than one score, because a single
relevance number was measurably not ranking: on real tasks it produced **three
distinct values across twenty sources**, leaving most of the order to arbitrary
prior position. The axes are *topical* (about the question as written),
*directness* (measures the outcome asked about, or a proxy) and *evidence*
(study design). A composite weights them 0.55 / 0.20 / 0.25, with a small
discount for preprints — derived from the corpus rather than asked of the model,
since "preprint" is a publication status and not a study design.

The judgement that matters most is **protocol**: a registered trial record
describes a study that may not have produced a single data point, and its title
is indistinguishable from a completed trial. Treating one as evidence of an
effect is the most misleading thing this pipeline could do, so it carries the
lowest design weight and is labelled in the interface.

**Facet coverage.** Selection guarantees every sub-query that retrieved results
contributes sources, before remaining slots go to the best scores. Pure ranking
silently deleted facets: observed on a real task, a sub-query that retrieved ten
results contributed **zero** sources, so the report quietly answered a narrower
question than the one asked, and nothing surfaced it.

After both changes, the same question went from 3 distinct scores across 20
sources with one facet lost, to 17 distinct scores across 19 sources with every
facet represented.

A dedicated cross-encoder reranker would beat this and is excluded by the
constraints: a hosted one adds a third-party credential and breaks the two-secret
inventory, and self-hosting means GPU inference, which the brief rules out. Using
the model listwise is the constrained-correct choice.

**Synthesise.** One Pro-tier call over numbered sources with full metadata. The
prompt instructs the model to omit claims it cannot ground in the provided
sources rather than filling gaps from parametric knowledge.

**Ground.** Citation-bearing sentences are classified `supported` / `partial` /
`unsupported` against the sources they cite, in one batched Flash call. The
verdicts are surfaced, not acted on: rewriting unsupported claims means a second
synthesis pass, which doubles the failure surface and can introduce new
ungrounded text. Showing the reader which claims are weak is more honest than
silently rewriting them.

### Source availability and cost

`GET /v1/datasources` was called once during development rather than discovering
limits at runtime. It returns 48 datasources, and live searches succeeded against
arXiv, PubMed, bioRxiv, clinical trials, patents and web — so source routing is
not constrained the way tiered-access documentation suggested. Clinical questions
can reach PubMed *and* clinical trials, and the preprint/published dedup case can
be exercised for real against arXiv or bioRxiv versus PubMed.

Cost varies about eightfold by source, which is what makes the budget gate
load-bearing rather than decorative. Measured pricing is roughly `cpm/1000` per
result: arXiv and PubMed at cpm 1.0, clinical trials at 5.0, patents at 8.0. At
ten results across five sub-queries, an all-arXiv task costs around $0.05 while an
all-patents task costs around $0.40 — over the $0.30 cap by itself. Hence the cap
is checked *before* each dispatch rather than after the fact, and the planner is
instructed not to route to expensive sources speculatively.

### Model selection

Flash tier (`gemini-3-flash-preview`) for planning, reranking and grounding; Pro
tier (`gemini-2.5-pro`) for the single synthesis call.

There is no Gemini 3 Pro available on this project — every `gemini-3-*-pro`
identifier returns 404 — so synthesis uses the strongest model that is actually
reachable. `gemini-2.5-pro` retires on 16 October 2026. That is accepted
knowingly rather than overlooked: synthesis is the one call whose quality appears
directly in the deliverable, and both identifiers are environment variables, so
moving to Gemini 3 Pro when it lands is a redeploy rather than a code change.

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

**SSE, with polling as the fallback.** The frontend follows a task by server-sent
events, falling back to polling after repeated stream failures.

The constraint that shaped it: watching Firestore needs Google credentials, and a
service account key in Vercel would be a third secret and the only long-lived key
file in the system. So the listener lives on Cloud Run — which already has that
access through its own service account — and the Vercel route handler proxies the
stream, adding the API key. The browser still never touches the backend directly.

Vercel's function duration limit cuts the connection before a long task ends,
which means reconnection was never optional. `EventSource` handles it, and
because the backend replays current state on subscribe a reconnect resumes
cleanly. The polling path remains as a genuine fallback rather than dead code.

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
