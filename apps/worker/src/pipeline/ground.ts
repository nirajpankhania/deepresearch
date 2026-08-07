import type { ClaimVerdict, GroundedClaim, GroundingReport, Source } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

import type { GeminiClient } from '../clients/gemini.js';

/**
 * Stage 6 — claim grounding. The Task 3 orchestration improvement.
 *
 * A synthesis prompt that says "only claim what the sources support" is an
 * instruction, not a guarantee. This stage checks it: every citation-bearing
 * sentence is re-read against the text of the source it cites and classified
 * `supported`, `partial` or `unsupported`.
 *
 * **Verdicts are surfaced, never acted on.** Rewriting unsupported claims would
 * mean a second synthesis pass — double the failure surface, and a real risk of
 * introducing new ungrounded text while removing old. Telling the reader which
 * sentences are weak is both cheaper and more honest than silently repairing
 * them, because the reader can then check those specific claims first.
 */

/** Matches `[1]` and `[1, 2]`. */
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Abbreviations that end in a full stop without ending a sentence.
 *
 * Scientific prose is dense with these — "2.4 mg", "Smith et al.", "e.g." — and
 * splitting on them yields fragments no model can sensibly verify.
 */
const ABBREVIATIONS = [
  'e.g', 'i.e', 'et al', 'vs', 'cf', 'approx', 'ca', 'no', 'fig', 'figs', 'tab',
  'eq', 'ref', 'refs', 'dr', 'prof', 'mr', 'mrs', 'ms', 'st', 'jr', 'sr',
  'inc', 'ltd', 'co', 'al', 'p', 'pp', 'vol', 'ed', 'eds', 'ch', 'sec',
];

const ABBREVIATION_TAIL = new RegExp(`(?:^|[\\s(])(?:${ABBREVIATIONS.join('|')})\\.$`, 'i');

/** True when a candidate break is inside a decimal number, e.g. "2.4 mg". */
function isDecimal(text: string, index: number): boolean {
  return /\d$/.test(text.slice(0, index)) && /^\s*\d/.test(text.slice(index + 1));
}

/**
 * Splits prose into sentences, tolerating the abbreviations and decimals that
 * make a naive `.split('.')` useless on scientific text.
 *
 * Markdown headings and list markers are stripped first: a heading is not a
 * claim, and a bullet's leading `-` is not part of the sentence.
 */
export function splitSentences(markdown: string): string[] {
  const prose = markdown
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (prose === '') return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < prose.length; i++) {
    const char = prose[i];
    if (char !== '.' && char !== '!' && char !== '?') continue;

    // A break needs whitespace after it, or it is mid-token.
    const next = prose[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    if (char === '.' && isDecimal(prose, i)) continue;

    const candidate = prose.slice(start, i + 1);
    if (char === '.' && ABBREVIATION_TAIL.test(candidate)) continue;

    const trimmed = candidate.trim();
    if (trimmed !== '') sentences.push(trimmed);
    start = i + 1;
  }

  const tail = prose.slice(start).trim();
  if (tail !== '') sentences.push(tail);

  return sentences;
}

/** Drops the generated sources list, whose links would read as citations. */
function body(report: string): string {
  const index = report.search(/^##\s+Sources\s*$/m);
  return index === -1 ? report : report.slice(0, index);
}

export interface ExtractedClaim {
  sentence: string;
  citedSourceIds: string[];
}

/**
 * Every citation-bearing sentence, with the sources it cites.
 *
 * Uncited sentences are skipped deliberately. They are framing and transitions,
 * and judging them against sources they never claimed to rest on would produce
 * a stream of false "unsupported" verdicts that would make the whole signal
 * useless.
 */
export function extractClaims(report: string, sources: Source[]): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  for (const sentence of splitSentences(body(report))) {
    const ids = new Set<string>();

    for (const match of sentence.matchAll(CITATION)) {
      for (const part of (match[1] ?? '').split(',')) {
        const n = Number.parseInt(part.trim(), 10);
        const source = sources[n - 1];
        if (Number.isInteger(n) && source) ids.add(source.id);
      }
    }

    if (ids.size > 0) claims.push({ sentence, citedSourceIds: [...ids] });
  }

  return claims;
}

const GROUNDING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          verdict: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
          reason: { type: 'string' },
        },
        required: ['index', 'verdict'],
      },
    },
  },
  required: ['verdicts'],
};

/** Source text given to the checker per claim. Enough to judge, not enough to blow context. */
const EVIDENCE_CHARS = 1500;

/**
 * Builds the grounding prompt with each source's text stated **once**.
 *
 * The obvious structure — inline the evidence beneath every claim — repeats a
 * source's full text for each claim that cites it. A source cited by eight
 * sentences appeared eight times, which on a 20-source report pushed the prompt
 * past the 60s model timeout and cost three attempts before giving up. Listing
 * sources once and having claims reference them by number says the same thing in
 * a fraction of the tokens.
 */
export function buildPrompt(claims: ExtractedClaim[], sources: Source[]): string {
  const numberById = new Map(sources.map((s, i) => [s.id, i + 1]));

  // Only sources something actually cites; an uncited source is dead weight here.
  const citedIds = new Set(claims.flatMap((c) => c.citedSourceIds));
  const evidence = sources
    .filter((s) => citedIds.has(s.id))
    .map(
      (s) =>
        `[${numberById.get(s.id)}] ${s.title}\n${(s.snippet ?? '(no extracted text)').slice(0, EVIDENCE_CHARS)}`,
    )
    .join('\n\n');

  const blocks = claims.map((claim, i) => {
    const refs = claim.citedSourceIds
      .map((id) => numberById.get(id))
      .filter((n): n is number => n !== undefined)
      .join(', ');
    return `[${i}] cites source ${refs} — ${claim.sentence}`;
  });

  return `You are checking whether each claim is supported by the source text it cites.

For each claim, judge ONLY against the source text provided for that claim. Do
not use outside knowledge. A claim you believe is true but which the provided
text does not state is NOT supported — that distinction is the entire point of
this check.

  supported    the source text states this, or states something it follows from
               directly. Numbers, populations and directions of effect match.
  partial      the source text supports part of the claim but not all of it —
               a hedge dropped, a number generalised, a population widened, or
               a mechanism asserted more strongly than the text warrants.
  unsupported  the source text does not state this, contradicts it, or the
               extracted text does not contain the relevant passage.

Use "unsupported" when the source text is truncated or missing rather than
guessing: an unverifiable claim is not a verified one.

The reason must be one short sentence, and must say what specifically differs
for partial and unsupported verdicts.

Return a verdict for every claim index from 0 to ${claims.length - 1}. JSON only.

SOURCE TEXT
${evidence}

CLAIMS TO CHECK
${blocks.join('\n')}`;
}

interface RawGrounding {
  verdicts?: unknown;
}

const VERDICTS = new Set<ClaimVerdict>(['supported', 'partial', 'unsupported']);

/**
 * Applies verdicts to claims.
 *
 * A claim the model did not judge defaults to `unsupported`, never to
 * `supported` — the count is a verification claim shown to a reader, and a
 * missing judgement is an absence of evidence, not evidence of support.
 */
export function parseGroundingResponse(
  raw: unknown,
  claims: ExtractedClaim[],
): GroundingReport {
  const byIndex = new Map<number, { verdict: ClaimVerdict; reason?: string }>();
  const verdicts = (raw as RawGrounding | null)?.verdicts;

  if (Array.isArray(verdicts)) {
    for (const entry of verdicts) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;

      const index = e['index'];
      const verdict = e['verdict'];
      if (typeof index !== 'number' || !Number.isInteger(index)) continue;
      if (index < 0 || index >= claims.length) continue;
      if (typeof verdict !== 'string' || !VERDICTS.has(verdict as ClaimVerdict)) continue;

      byIndex.set(index, {
        verdict: verdict as ClaimVerdict,
        ...(typeof e['reason'] === 'string' && e['reason'] !== '' ? { reason: e['reason'] } : {}),
      });
    }
  }

  const graded: GroundedClaim[] = claims.map((claim, i) => {
    const judged = byIndex.get(i);
    return {
      sentence: claim.sentence,
      citedSourceIds: claim.citedSourceIds,
      verdict: judged?.verdict ?? 'unsupported',
      ...(judged?.reason ? { reason: judged.reason } : {}),
    };
  });

  return {
    claims: graded,
    supportedCount: graded.filter((c) => c.verdict === 'supported').length,
    totalCount: graded.length,
    mode: 'per-claim',
  };
}

export interface GroundingOptions {
  gemini: GeminiClient;
  report: string;
  sources: Source[];
  log: Logger;
}

/**
 * Returns null when grounding could not run. The report is the deliverable;
 * grounding is an enhancement, and failing a completed task because a
 * verification pass errored would be the wrong trade.
 */
export async function groundReport(opts: GroundingOptions): Promise<GroundingReport | null> {
  const { gemini, report, sources, log } = opts;

  const claims = extractClaims(report, sources);
  if (claims.length === 0) {
    log.warn('grounding skipped, no citation-bearing sentences found');
    return null;
  }

  try {
    const raw = await gemini.generateJson<RawGrounding>({
      tier: 'flash',
      stage: 'grounding',
      prompt: buildPrompt(claims, sources),
      responseSchema: GROUNDING_SCHEMA,
      // One batched call over every claim: cheaper and more consistent than a
      // call per claim, since the model sees the whole report's claims at once.
      maxOutputTokens: 16_384,
      thinkingBudget: 4096,
      temperature: 0,
      // The largest prompt in the pipeline, and the last stage: a slow response
      // here is worth waiting for, since the alternative is losing the verdicts
      // on an otherwise finished report.
      timeoutMs: 120_000,
    });

    const grounding = parseGroundingResponse(raw, claims);
    log.info('grounding complete', {
      claims: grounding.totalCount,
      supported: grounding.supportedCount,
      partial: grounding.claims.filter((c) => c.verdict === 'partial').length,
      unsupported: grounding.claims.filter((c) => c.verdict === 'unsupported').length,
    });
    return grounding;
  } catch (err: unknown) {
    log.warn('grounding failed, completing without verdicts', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
