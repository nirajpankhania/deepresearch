# Claim grounding

The one orchestration improvement implemented, with a before-and-after from a
real task.

## The problem

The synthesis prompt tells the model to omit claims it cannot ground in the
provided sources. That is an instruction, not a guarantee, and there is no way
for a reader to tell the difference between a report that followed it and one
that did not. Both look identical: fluent prose, citation markers after every
claim.

This matters more for research than for most generation tasks. The reader is
usually checking the answer against their own knowledge of the field, and a
report that is 90% grounded and 10% confabulated is more dangerous than one that
is obviously unreliable — it earns trust with the 90% and spends it on the 10%.

## What it does

After synthesis, every citation-bearing sentence is extracted and re-read against
the text of the source it cites. One batched Flash call classifies each as
`supported`, `partial` or `unsupported`, with a one-sentence reason.

The judgement is explicitly *against the provided source text only*. A claim the
checker believes is true, but which the cited text does not state, is not
supported — that distinction is the entire point. Truncated or missing source
text yields `unsupported` rather than a guess, because an unverifiable claim is
not a verified one.

Uncited sentences are skipped. They are framing and transitions, and judging them
against sources they never claimed to rest on would produce a stream of false
negatives that would drown the signal.

**Verdicts are surfaced, never acted on.** Rewriting weak claims would mean a
second synthesis pass: double the failure surface, and a real risk of introducing
new ungrounded text while removing old. Telling the reader which four sentences
are weak is cheaper, and more honest, than silently repairing them.

## Before and after

Question: *Does semaglutide preserve lean muscle mass in older adults during
weight loss?* — 20 sources, 20 cited claims.

### Before

The reader gets a fluent, fully cited report. Every claim carries a `[n]` marker.
There is no way to tell which markers survive contact with the source text, short
of opening all twenty sources and reading them.

### After

```
15 of 20 cited claims are fully supported by the source they cite.

  ███████████████████████████████████░░░░░░░░  15 supported
                                       ░░░     1 partly supported
                                          ░░░  4 not supported
```

The four unsupported claims are listed with reasons. The most useful one:

> **Not supported** — "A narrative review on obesity pharmacotherapy in this
> population notes that *"scarce evidence exists"* for agents like semaglutide [7]."
>
> *The provided text does not contain the phrase 'scarce evidence exists' for
> semaglutide; it discusses the obesity paradox and incretin receptor agonists
> generally.*

**That is a fabricated quotation.** The report attributes a direct quote, in
quotation marks, to a source that does not contain it. It is the single most
damaging error a research tool can make, it is invisible in the "before" version,
and it sits inside an otherwise accurate report — exactly the pattern described
above.

Two of the other three flagged the opposite failure, and one worth noting:

> **Not supported** — "The section intended to discuss semaglutide-based clinical
> evidence from the SUSTAIN trials cuts off mid-sentence [2]."
>
> *The provided text discusses liraglutide and ends with a sentence about
> liraglutide; it does not mention the SUSTAIN trials.*

Here the synthesis model correctly noticed that a source was truncated, but
misdescribed *what* was truncated. The grounding pass caught the
misattribution without discarding the underlying observation.

## Cost and reliability

One extra Flash call per task, batched over all claims — around $0.001, against
$0.03 for a typical task. Roughly 15 seconds of the ~90 second total.

Failure is non-fatal by design: if grounding errors or returns nothing usable,
the task completes without verdicts and the field is absent rather than empty, so
the interface distinguishes "not checked" from "checked and found nothing". The
report is the deliverable; grounding is an enhancement, and failing a completed
report because a verification pass errored would be the wrong trade.

## Limitations

- **The checker is the same family of model that wrote the report.** Shared
  blind spots are possible. A stronger design would use a different model, or
  retrieve the source passage independently rather than trusting the extracted
  snippet.
- **It judges against the extracted snippet, not the full document.** Valyu
  returns chunks; merging rejoins them, but a claim supported by a passage that
  was never retrieved reads as unsupported. This is the main source of false
  negatives, and it is why truncation yields `unsupported` rather than a guess.
- **Sentence splitting is heuristic.** It handles the abbreviations and decimals
  that scientific prose is dense with — `2.4 mg`, `et al.`, `e.g.` — but a
  sufficiently unusual construction could split badly and produce a fragment that
  cannot be judged fairly.
- **`partial` is the least reliable verdict**, since it depends on a judgement
  about degree rather than presence. The counts deliberately report only fully
  supported claims as supported.

## What I would explore next

- **Contradiction checks across sources**, so a report says two trials disagree
  rather than silently averaging them.
- **Adaptive follow-up searches** driven by these verdicts: an unsupported claim
  is a precise, cheap signal about which facet needs more retrieval, which is a
  better trigger than a fixed second round.
- **Retrieving the cited passage independently** at check time, via the contents
  endpoint, so grounding does not inherit retrieval's truncation.
