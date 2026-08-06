# Cost

Figures below are measured from the deployed system unless marked as estimated.
Valyu spend is exact — it comes from the search responses and is stored on every
task. Model spend is derived from measured token volumes against published
list prices, so it is approximate in a way the Valyu figure is not.

## Per task

A typical task: 4 sub-queries, 40 results, 20 sources after deduplication, an
800-word report, 20 claims checked. About **90 seconds** wall clock.

### Valyu retrieval — measured, $0.015 to $0.16

Stored on every task as `cost.totalUsd`, with the transaction ids.

| Observed | Cost | Note |
|---|---|---|
| PubMed / arXiv / bioRxiv heavy | $0.015 – $0.03 | the common case |
| Mixed, including chemRxiv or trials | $0.03 – $0.06 | |
| Patent-heavy | $0.10 – $0.16 | patents cost ~8× arXiv |

Pricing is roughly `cpm / 1000` per result: arXiv and PubMed at cpm 1.0, clinical
trials and chemRxiv at 5.0, patents at 8.0, web around 3.0. At 10 results across
5 sub-queries an all-patents task would cost about $0.40 — which is why the
**$0.30 per-task cap is checked before each dispatch** rather than reconciled
afterwards, and why the planner is told not to route to expensive corpora
speculatively.

### Model — estimated, $0.05 to $0.10

Four calls per task. Prompt and response sizes are measured; token counts are
those divided by four.

| Stage | Model | Prompt | Response | Duration |
|---|---|---|---|---|
| Plan | Flash | ~2.2k chars (~550 tok) | ~1.4k chars | 3 – 13 s |
| Rerank | Flash | ~16k chars (~4k tok) | ~1.1k chars | 3 – 18 s |
| Synthesise | **Pro** | ~46k chars (~11.6k tok) | ~5.3k chars | **35 – 40 s** |
| Ground | Flash | ~50k chars (~12.7k tok) | ~4.7k chars | 8 – 18 s |

**Reasoning tokens are the largest single variable and the least visible one.**
They bill as output and are invisible in the response, so the response-length
column above understates output billing considerably — a trivial prompt spent 611
reasoning tokens during testing. Budgets are capped explicitly
(`thinkingConfig.thinkingBudget`) at 2048 for planning, 1024 for reranking, and
4096 each for synthesis and grounding, which bounds this rather than leaving it
to the model.

Synthesis on the Pro tier dominates: it is the largest prompt, the longest
response, the biggest reasoning budget, and the most expensive per-token rate.
Roughly **60–70% of model spend sits in that one call.**

### All in

**$0.07 – $0.25 per task**, typically nearer $0.08. Compute is not a meaningful
term — the worker runs ~90 s on 1 vCPU / 1 GiB, about **$0.0006**.

## Fixed monthly

| Item | Cost | Note |
|---|---|---|
| Cloud Run API, `min-instances=1` | **~$10 – 15/mo** | the dominant fixed cost |
| Cloud Run worker | ~$0 idle | scales to zero; bills only while a task runs |
| Firestore | ~$0 | free tier: 50k reads, 20k writes, 1 GiB/day |
| Cloud Tasks | ~$0 | first 1M operations/month free |
| Cloud Storage | <$0.05 | traces, 30-day lifecycle |
| Cloud Build | ~$0 | 120 free build-minutes/day |
| Secret Manager | <$0.10 | two secrets, few accesses |
| Artifact Registry | <$0.50 | one image, a few revisions |
| Vercel | $0 | Hobby |

**`min-instances=1` is the whole fixed bill.** It exists to avoid cold starts
during review and should be 0 outside a review window, which takes the idle cost
to roughly nothing at the price of a few seconds on the first request.

## Where the bottlenecks are

**Model output, not input.** Output tokens cost roughly 8× input, and reasoning
tokens bill as output. The cheapest available lever is the synthesis reasoning
budget, not the size of the source corpus.

**Retrieval cost varies ~8× by corpus**, so cost per task is a function of what
the planner routes to, not of question difficulty. A single mis-routed patent
query costs more than an entire PubMed task.

**Firestore reads scale with viewers, not with tasks.** Each polling client reads
the task document every 2 seconds. One task watched by one person for 90 seconds
is ~45 reads. This is free at current volume and becomes the dominant cost well
before compute does — see [`scaling.md`](scaling.md).

**`min-instances` is a floor you pay whether or not anyone uses the system.**
At low volume it exceeds all variable cost combined: at ten tasks a day, the idle
API costs more than the research.

## Reducing it

Roughly in order of return:

1. **`min-instances=0`** outside a review window. Removes ~90% of the bill at
   ten tasks/day.
2. **Synthesise on Flash** for most questions, reserving Pro for long or
   contested corpora. Would cut model spend by more than half; the quality cost
   is real but unmeasured, and measuring it needs the eval harness listed as out
   of scope.
3. **Lower the reasoning budgets.** 4096 for grounding is generous for what is
   essentially a classification task.
4. **Cache the poll response** so N viewers of one task cost one Firestore read.
5. **Drop `MAX_RESULTS_PER_QUERY` from 10 to 6.** Directly proportional to Valyu
   spend, and deduplication already discards a third to a half of what is
   retrieved.
