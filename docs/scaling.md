# Scaling, and research orchestration

Task 3. Part one covers 10× and 100× load; part two covers the orchestration
techniques explored, of which one is implemented.

---

# Part 1 — Scaling

## The shape today

```
Browser ──poll 2s──► Vercel route handler ──► Cloud Run API ──► Firestore
                                                   │
                                                   ▼
                                            Cloud Tasks queue
                                                   │
                                                   ▼
                                            Cloud Run worker  ──► Vertex AI
                                            concurrency = 1    ──► Valyu
                                            max-instances = 5  ──► GCS
```

Deliberate ceilings, and the numbers they imply:

| Component | Setting | Ceiling |
|---|---|---|
| Worker | `concurrency=1`, `max-instances=5` | **5 concurrent tasks** |
| Worker | `timeout=900s`, tasks run ~90s | ~200 tasks/hour |
| Queue | 5 dispatches/s, 10 concurrent | not binding |
| API | `concurrency=80`, `max-instances=10` | 800 concurrent requests |
| Firestore | — | not binding at this volume |

`concurrency=1` on the worker is the important one. One research task per
instance means predictable memory and a clean mapping from Cloud Run's request
timeout to the per-task runtime limit — the platform enforces the limit rather
than application code that could fail to.

Baseline for the rest of this document: **~50 tasks/day**.

## 10× — 500 tasks/day

About 60/hour in an 8-hour working window, peaking maybe 150/hour. Against a
200/hour ceiling, that is uncomfortably close.

**What breaks first, in order:**

**1. Worker `max-instances=5`.** The queue absorbs the burst rather than dropping
it, so nothing fails — tasks just wait, and a user watching a queued task sees no
progress for minutes. Raise to 30–50. Cheap, and the worker scales to zero
between bursts so the idle cost is unchanged.

**2. Vertex AI quota.** This is the first *hard* wall, not a config value we own.
Four model calls per task at 150 tasks/hour is 600 calls/hour with the Pro
synthesis call concentrated in a 40-second window each. Default per-project
quotas are not generous for Pro-tier models. Needs a quota increase request
before it is needed, since approval is not instant — and `callWithRetry` already
treats 429 as retryable, so the first symptom would be latency rather than
failure.

**3. Unit cost becomes visible.** 500 × $0.08 = **$40/day**, ~$1,200/month.
Still small, but this is the point where an uncapped endpoint stops being a
theoretical concern.

**Changes at 10×:** raise worker `max-instances`; request Vertex quota; add
per-caller rate limiting to the API; cache the `GET /tasks/:id` response for
~2 seconds so several viewers of one task cost one Firestore read.

Nothing architectural. The design already separates the tiers that need to scale
independently.

## 100× — 5,000 tasks/day

~625/hour sustained, peaking 1,500–2,000/hour. Sustained concurrency around 16
tasks, peaks near 50.

**What breaks, in order:**

**1. Cost, well before infrastructure.** 5,000 × $0.08–0.25 = **$400–1,250/day**,
or **$12k–37k/month**. Nothing in the architecture strains at this volume; the
unit economics do. This is the honest headline: at 100× the system does not fall
over, it becomes unaffordable, and the engineering response is economic rather
than structural —

  - per-user quotas and daily caps, which requires the multi-user auth currently
    out of scope;
  - Flash-tier synthesis by default with Pro reserved for long or contested
    corpora, more than halving model spend;
  - a result cache keyed on normalised question plus date range. Research
    questions repeat, and a 24-hour cache on identical questions is free money;
  - lower `MAX_RESULTS_PER_QUERY`, since deduplication already discards a third
    to a half of what is retrieved.

**2. Vertex throughput.** ~2,500 model calls/hour sustained. On-demand quota is
the wrong instrument here; this wants provisioned throughput for the Pro tier,
with on-demand as spillover.

**3. Valyu rate limits and spend.** $150–800/day flowing through one API key.
Both a rate-limit question and a blast-radius question — one runaway loop spends
the month's budget. The per-task ledger caps a task; nothing currently caps a
*day*. A global spend circuit-breaker in Firestore, checked before dispatch,
becomes necessary.

**4. Cold starts on the worker.** At 50 concurrent instances cycling, cold starts
are a visible fraction of latency. `min-instances` on the worker, sized to
sustained concurrency rather than peak.

**5. Queue contention.** One queue is still fine at 500 dispatches/second, but a
single queue means one retry policy and one blast radius. Shard by priority —
interactive versus batch — so a backlog of bulk jobs cannot delay a user watching
a spinner.

**6. Observability stops being optional.** At 50 tasks/day, reading logs works.
At 5,000, you need per-stage latency percentiles, cost-per-task distribution,
failure rate by stage, and queue depth as a first-class alert. The structured
logging is already in place and already carries `durationMs`, `costUsd` and
`stage` — what is missing is aggregation, not instrumentation.

## The client tier is its own load pattern

Worth separating, because it scales on a different axis from the work.

Each client polls every 2 seconds while its task is running, widening to 5
seconds after a minute. A 90-second task watched by one person is roughly **45
requests and 45 Firestore reads**. At 5,000 tasks/day with one viewer each that
is ~225k reads/day — perhaps $0.10 beyond the free tier. **In money, polling is
nothing.**

The problem is not cost, it is the failure mode:

> **Polling load scales with queue depth, not with throughput.** When the system
> is healthy, polling load is bounded by worker concurrency, because only running
> tasks are watched. When the system saturates, tasks sit in `queued` while
> clients keep polling — so the number of pollers grows with the backlog, adding
> API and Firestore load exactly when the system is least able to absorb it.
> Slow → more queued tasks → more pollers → slower.

That compounding is the real risk, and it is invisible in a capacity calculation
that only models the happy path.

Mitigations, in order of cost to build:

1. **Back off much harder when `queued`.** A task that has not started needs
   polling every 15 seconds, not every 2. One-line change, removes most of the
   compounding.
2. **Cache the poll response** for ~2s at the route handler or a CDN. N viewers
   of one task become one Firestore read.
3. **Conditional requests** — ETag on the task document, `304` when unchanged.
   Cuts bandwidth, not request count.
4. **Only then consider streaming.** SSE or Firestore realtime listeners remove
   polling entirely, but realtime listeners from the browser need per-user auth
   and security rules, which means the multi-user model. Worth it at 100×, not
   before — and the polling design was chosen precisely so this is an upgrade
   rather than a rewrite.

## Architecture at 100×

```
Browser ──poll, backoff by state──► Vercel ──► Cloud Run API (min 2, max 50)
                                                 │         │
                                    ┌────────────┘         └──► Memorystore
                                    │                            (task cache,
                                    ▼                             2s TTL)
                       ┌── interactive queue ──┐
                       │                       │
                       └── batch queue ────────┤
                                               ▼
                                    Cloud Run worker (min 15, max 200)
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                  Vertex AI                 Valyu              Firestore
              (provisioned + spillover)  (global spend      (tasks, + daily
                                          circuit-breaker)   spend counter)
```

Additions, all of which are load-driven rather than speculative: a cache in front
of task reads, queue sharding by priority, a global spend circuit-breaker, and
provisioned model throughput.

## What I would measure before changing any of it

Instrumentation exists for all of these; aggregation does not.

| Metric | Why | Where it comes from |
|---|---|---|
| Per-stage p50/p95/p99 | Which stage to optimise. Synthesis is ~40% of wall clock today — verify before assuming | `durationMs`, already logged |
| Cost per task, distributed | The mean hides patent-heavy outliers that cost 8× | `cost.totalUsd`, already stored |
| Queue depth and oldest task age | The leading indicator of the polling compounding above | Cloud Tasks metrics |
| Vertex 429 rate | Distinguishes "slow" from "throttled" — they look identical from outside | retry logs |
| Polls per task | Validates the load model; if it exceeds ~45, tasks are queueing | API access logs |
| Failure rate by stage | `error.stage` is stored precisely for this | Firestore |

The general principle: every ceiling above is a configuration value or a quota,
not a rewrite. That is the point of the current shape — the tiers that need to
scale independently already do.

---

# Part 2 — Research orchestration

## Implemented: claim grounding

Every citation-bearing sentence is re-read against the source it cites and
classified `supported` / `partial` / `unsupported`. On a real task it caught a
**fabricated quotation** — a direct quote, in quotation marks, attributed to a
source that does not contain it, inside an otherwise accurate report.

Full write-up with the before-and-after: [`claim-grounding.md`](claim-grounding.md).

## Explored, and why they are not built

**Adaptive follow-up searches.** Run a second retrieval round targeting facets the
first round covered thinly. The version I would build is not a fixed second round
but one *driven by the grounding verdicts*: an unsupported claim is a precise,
cheap signal about which facet lacks evidence, which is a far better trigger than
a heuristic. Not built because it doubles worst-case task cost and latency, and
needs a convergence rule to avoid unbounded loops.

**Contradiction checks.** Detect where two sources disagree and surface the
disagreement rather than letting synthesis silently average them. Genuinely
valuable for scientific questions — conflicting trial results are the normal
case, not an edge case. Needs pairwise comparison over the corpus, which is
O(n²) model calls unless clustered first.

**Confidence scoring on the answer as a whole**, derived from corpus size,
evidence strength, source agreement and grounding verdicts. Attractive, but a
single number invites exactly the over-trust the design is trying to avoid; the
per-claim verdicts convey the same information without collapsing it.

**Cost-aware search depth.** Spend the retrieval budget adaptively — stop early
on a question the corpus answers cleanly, go deeper on a contested one. The
budget ledger already supports this; what is missing is a stopping rule with any
evidential basis.

**A lightweight evaluation loop.** The honest version needs a labelled question
set with known-good answers, which is a project in itself. Claim grounding is the
tractable subset: it measures faithfulness to retrieved sources, which is
checkable automatically, rather than correctness, which is not.

**Research memory across tasks.** Reuse retrieved sources for related questions.
Real savings at scale, and it doubles as the result cache described above — but
staleness is the hazard, and in a fast-moving field a cached corpus is a wrong
answer with a confident citation.
