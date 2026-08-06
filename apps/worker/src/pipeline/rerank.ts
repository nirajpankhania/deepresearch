import type { Source } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

import type { GeminiClient } from '../clients/gemini.js';

/**
 * Stage 4b — rescore the merged corpus against the *original* question.
 *
 * Valyu computes relevance per sub-query. A source that ranked top for a narrow
 * facet ("mechanism of GLP-1 action on skeletal muscle") can be marginal to the
 * question actually asked, and after merging five sub-queries the scores are not
 * comparable with each other at all — they were produced against five different
 * queries.
 *
 * This is baseline retrieval quality rather than the Task 3 improvement: without
 * it, "top 20 by relevance" means "top 20 by five incommensurable scales".
 */

const RERANK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          score: { type: 'number' },
        },
        required: ['index', 'score'],
      },
    },
  },
  required: ['scores'],
};

/** Snippet budget per source. Enough to judge relevance, not enough to blow context. */
const SNIPPET_CHARS = 500;

/** Below this there is nothing meaningful to reorder, so the call is not worth its failure risk. */
const MIN_SOURCES_TO_RERANK = 4;

function buildPrompt(question: string, sources: Source[]): string {
  const listing = sources
    .map((s, i) => {
      const meta = [s.dataset, s.publicationDate, s.authors?.slice(0, 3).join(', ')]
        .filter(Boolean)
        .join(' · ');
      return `[${i}] ${s.title}\n    ${meta}\n    ${(s.snippet ?? '').slice(0, SNIPPET_CHARS)}`;
    })
    .join('\n\n');

  return `Score each source for how directly it helps answer this research question.

QUESTION: ${question}

Scoring guide:
  1.0  directly answers the question, or reports primary evidence bearing on it
  0.7  substantially relevant: same intervention, population, or mechanism
  0.4  background or tangential: related field, but does not bear on the question
  0.0  not relevant

Judge relevance to the question as written. A source may be excellent work and
still score low here because it addresses a different question. Do not reward a
source for being recent or highly cited if it does not bear on the question.

SOURCES:
${listing}

Return a score for every index from 0 to ${sources.length - 1}. JSON only.`;
}

interface RawScores {
  scores?: unknown;
}

/** Parses scores defensively; anything unusable is simply left unscored. */
export function parseRerankResponse(raw: unknown, count: number): Map<number, number> {
  const out = new Map<number, number>();
  const scores = (raw as RawScores | null)?.scores;
  if (!Array.isArray(scores)) return out;

  for (const entry of scores) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const index = e['index'];
    const score = e['score'];
    if (typeof index !== 'number' || typeof score !== 'number') continue;
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    if (!Number.isFinite(score)) continue;
    out.set(index, Math.min(1, Math.max(0, score)));
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

  // Reranking is not only about truncation. Even within the cap it reorders the
  // corpus against the actual question, which decides what synthesis reads
  // first and the order sources appear in the report. Skipping it whenever the
  // corpus happened to fit under the cap left the stage almost never running,
  // and left the ordering on Valyu's per-sub-query scores — which are not
  // comparable across sub-queries.
  if (sources.length < MIN_SOURCES_TO_RERANK) {
    log.info('rerank skipped, too few sources to reorder', { count: sources.length });
    return sources.slice(0, limit);
  }

  let scored: Map<number, number>;
  try {
    const raw = await gemini.generateJson<RawScores>({
      tier: 'flash',
      prompt: buildPrompt(question, sources),
      responseSchema: RERANK_SCHEMA,
      // Covers reasoning tokens as well as output on the Gemini 3 line, and the
      // source listing makes this prompt long.
      maxOutputTokens: 8192,
      thinkingBudget: 1024,
      temperature: 0,
    });
    scored = parseRerankResponse(raw, sources.length);
  } catch (err: unknown) {
    // Graceful degradation: reranking improves selection, it is not required for
    // a usable report. Falling back to Valyu's own ordering beats failing.
    log.warn('rerank failed, falling back to retrieval order', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return sources.slice(0, limit);
  }

  if (scored.size === 0) {
    log.warn('rerank returned no usable scores, falling back to retrieval order');
    return sources.slice(0, limit);
  }

  return sources
    .map((source, index) => {
      const rerankScore = scored.get(index);
      return rerankScore === undefined ? source : { ...source, rerankScore };
    })
    .sort((a, b) => (b.rerankScore ?? b.relevanceScore ?? 0) - (a.rerankScore ?? a.relevanceScore ?? 0))
    .slice(0, limit);
}
