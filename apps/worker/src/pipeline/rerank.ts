import type { EvidenceType, Source } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

import type { GeminiClient } from '../clients/gemini.js';
import { type Judgement, scoreSource, selectWithFacetCoverage } from './scoring.js';

/**
 * Stage 4b — judge the merged corpus against the *original* question.
 *
 * Valyu computes relevance per sub-query, so after merging five sub-queries the
 * scores are five incommensurable scales. This restores a single ordering.
 *
 * It asks for three judgements per source rather than one number, because
 * "relevance" conflates things that matter differently in research. Measured on
 * real tasks, a single four-point relevance score produced **three distinct
 * values across twenty sources** — meaning most of the ordering was decided by
 * arbitrary prior position, not by the ranker. Separating topicality from study
 * design from directness gives the composite enough resolution to actually rank,
 * and each judgement is independently useful to a reader.
 *
 * This is baseline retrieval quality rather than the Task 3 improvement.
 */

const RERANK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    judgements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          topical: { type: 'integer' },
          directness: { type: 'integer' },
          evidence: {
            type: 'string',
            enum: [
              'meta-analysis',
              'rct',
              'observational',
              'review',
              'in-vitro',
              'modelling',
              'case-report',
              'protocol',
              'other',
            ],
          },
          reason: { type: 'string' },
        },
        required: ['index', 'topical', 'directness', 'evidence'],
      },
    },
  },
  required: ['judgements'],
};

/**
 * Snippet budget per source. Raised from 500: a trial protocol and a completed
 * trial are frequently indistinguishable in the first 500 characters, and
 * telling them apart is the most valuable judgement this stage makes.
 */
const SNIPPET_CHARS = 900;

/** Below this there is nothing meaningful to reorder. */
const MIN_SOURCES_TO_RERANK = 4;

const VALID_EVIDENCE = new Set<EvidenceType>([
  'meta-analysis',
  'rct',
  'observational',
  'review',
  'in-vitro',
  'modelling',
  'case-report',
  'protocol',
  'other',
]);

function buildPrompt(question: string, sources: Source[]): string {
  const listing = sources
    .map((s, i) => {
      const meta = [s.dataset, s.publicationDate, s.authors?.slice(0, 3).join(', ')]
        .filter(Boolean)
        .join(' · ');
      return `[${i}] ${s.title}\n    ${meta}\n    ${(s.snippet ?? '').slice(0, SNIPPET_CHARS)}`;
    })
    .join('\n\n');

  return `Judge each source against this research question, on three separate axes.

QUESTION: ${question}

TOPICAL (0-100) — how much this source is about the question as written.
  100  directly addresses the question
   60  same intervention or mechanism, different population or outcome
   30  related field, background context only
    0  not relevant
A source may be excellent work and still score low, because it addresses a
different question. Do not reward a source for being recent or highly cited.

DIRECTNESS (0-100) — does it measure what the question asks about, or a proxy?
  100  measures the exact outcome in the population asked about
   60  measures a close surrogate, or a different population
   30  measures an upstream mechanism the outcome is inferred from
    0  the connection is speculative
Separate from topical: a paper can be entirely on-topic while measuring a
biomarker rather than the clinical outcome asked about.

EVIDENCE — the study design. Choose exactly one:
  meta-analysis  systematic review with pooled quantitative synthesis
  rct            randomised controlled trial reporting results
  observational  cohort, case-control, cross-sectional, registry analysis
  review         narrative review, perspective, editorial
  in-vitro       cell, tissue or animal work
  modelling      simulation, computational or theoretical work
  case-report    single case or small series
  protocol       a study that has NOT reported results: a registered trial
                 record, a protocol paper, a planned analysis
  other          none of the above, or cannot tell

The protocol distinction matters more than the rest. A registered trial record
describes a study that may not have produced a single data point, and it will
look highly relevant from its title. Mark it "protocol" — never "rct".

SPREAD THE SCORES. If several sources look similar, find what separates them:
population, outcome measured, sample size, whether results are reported at all.
Scores clustered at 100 are not a ranking and are worse than useless here.

REASON — one short clause on what decided the score. Read by a human.

Return a judgement for every index from 0 to ${sources.length - 1}. JSON only.

SOURCES:
${listing}`;
}

interface RawJudgements {
  judgements?: unknown;
}

/**
 * Parses judgements defensively.
 *
 * Anything unusable is dropped rather than defaulted optimistically: a source
 * the model failed to judge should fall back to its retrieval score, not be
 * assumed excellent.
 */
export function parseJudgements(raw: unknown, count: number): Map<number, Judgement> {
  const out = new Map<number, Judgement>();
  const judgements = (raw as RawJudgements | null)?.judgements;
  if (!Array.isArray(judgements)) return out;

  for (const entry of judgements) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;

    const index = e['index'];
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    if (index < 0 || index >= count) continue;

    const topical = e['topical'];
    const directness = e['directness'];
    if (typeof topical !== 'number' || !Number.isFinite(topical)) continue;
    if (typeof directness !== 'number' || !Number.isFinite(directness)) continue;

    const evidence = e['evidence'];
    const evidenceType: EvidenceType =
      typeof evidence === 'string' && VALID_EVIDENCE.has(evidence as EvidenceType)
        ? (evidence as EvidenceType)
        : 'other';

    out.set(index, {
      topical: Math.min(1, Math.max(0, topical / 100)),
      directness: Math.min(1, Math.max(0, directness / 100)),
      evidenceType,
    });
  }

  return out;
}

/** Reasons, parsed separately because they are presentational, not scoring input. */
export function parseReasons(raw: unknown, count: number): Map<number, string> {
  const out = new Map<number, string>();
  const judgements = (raw as RawJudgements | null)?.judgements;
  if (!Array.isArray(judgements)) return out;

  for (const entry of judgements) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const index = e['index'];
    const reason = e['reason'];
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    if (index < 0 || index >= count) continue;
    if (typeof reason === 'string' && reason.trim() !== '') out.set(index, reason.trim());
  }

  return out;
}

export interface RerankOptions {
  gemini: GeminiClient;
  question: string;
  sources: Source[];
  limit: number;
  log: Logger;
}

export async function rerankSources(opts: RerankOptions): Promise<Source[]> {
  const { gemini, question, sources, limit, log } = opts;

  if (sources.length === 0) return [];

  if (sources.length < MIN_SOURCES_TO_RERANK) {
    log.info('rerank skipped, too few sources to reorder', { count: sources.length });
    return sources.slice(0, limit);
  }

  let judgements: Map<number, Judgement>;
  let reasons: Map<number, string>;

  try {
    const raw = await gemini.generateJson<RawJudgements>({
      tier: 'flash',
      stage: 'reranking',
      prompt: buildPrompt(question, sources),
      responseSchema: RERANK_SCHEMA,
      // Three judgements plus a reason per source is a much larger response than
      // a single score, and this budget covers reasoning tokens too.
      maxOutputTokens: 16_384,
      thinkingBudget: 2048,
      temperature: 0,
    });
    judgements = parseJudgements(raw, sources.length);
    reasons = parseReasons(raw, sources.length);
  } catch (err: unknown) {
    // Graceful degradation: reranking improves selection, it is not required for
    // a usable report. Falling back to Valyu's own ordering beats failing.
    log.warn('rerank failed, falling back to retrieval order', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return sources.slice(0, limit);
  }

  if (judgements.size === 0) {
    log.warn('rerank returned no usable judgements, falling back to retrieval order');
    return sources.slice(0, limit);
  }

  const scored: Source[] = sources.map((source, index) => {
    const judgement = judgements.get(index);
    if (!judgement) {
      // Unjudged: keep Valyu's score so it still sorts, but do not flatter it.
      return { ...source, rerankScore: source.relevanceScore ?? 0 };
    }

    const reason = reasons.get(index);
    return {
      ...source,
      rerankScore: scoreSource(source, judgement),
      topicalScore: judgement.topical,
      directnessScore: judgement.directness,
      evidenceType: judgement.evidenceType,
      ...(reason ? { rerankReason: reason } : {}),
    };
  });

  const selected = selectWithFacetCoverage(scored, limit);

  log.info('rerank complete', {
    judged: judgements.size,
    of: sources.length,
    selected: selected.length,
    distinctScores: new Set(selected.map((s) => s.rerankScore)).size,
    facetsRepresented: new Set(selected.map((s) => s.fromQueryIndex)).size,
    protocols: selected.filter((s) => s.evidenceType === 'protocol').length,
  });

  return selected;
}
