import type { DateRange, PlannedQuery } from '@deepresearch/shared';

import type { GeminiClient } from '../clients/gemini.js';

/**
 * Stage 1 — decompose a research question into targeted sub-queries.
 *
 * A single unparameterised `search(question)` serves scientific questions badly,
 * and Valyu's query syntax offers no escape hatch: `site:`, `AND`, `OR` and
 * quoted phrases are all rejected, so precision cannot come from operators. It
 * has to come from decomposition and from routing each sub-query to the right
 * corpus, which is what this stage does.
 */

export const MIN_QUERIES = 3;
export const MAX_QUERIES = 5;

/**
 * Sources the assignment key was verified to reach on 2026-08-05. The model is
 * constrained to this list because a hallucinated dataset slug produces a
 * runtime failure that is invisible until retrieval returns nothing.
 */
export const ALLOWED_SOURCES = [
  'valyu/valyu-arxiv',
  'valyu/valyu-pubmed',
  'valyu/valyu-biorxiv',
  'valyu/valyu-medrxiv',
  'valyu/valyu-chemrxiv',
  'valyu/valyu-clinical-trials',
  'valyu/valyu-chembl',
  'valyu/valyu-drug-labels',
  'valyu/valyu-open-targets',
  'valyu/valyu-pubchem',
  'valyu/valyu-openfda-drug-events',
  'valyu/valyu-who-health-data',
  'valyu/valyu-nih-grants',
  'valyu/valyu-patents',
  'valyu/valyu-patents-epo',
  'web',
] as const;

const FALLBACK_SOURCES = ['valyu/valyu-arxiv', 'web'];

/** Operators Valyu rejects. Stripped rather than failed, so one bad query costs nothing. */
const BANNED_OPERATORS = /\b(AND|OR|NOT)\b|site:|["“”]/g;

export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      minItems: MIN_QUERIES,
      maxItems: MAX_QUERIES,
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          includedSources: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['query', 'includedSources', 'rationale'],
      },
    },
  },
  required: ['queries'],
};

export function buildPlanPrompt(question: string, dateRange?: DateRange): string {
  const dateNote =
    dateRange?.start || dateRange?.end
      ? `\nThe user restricted results to ${dateRange.start ?? 'any date'} → ${dateRange.end ?? 'today'}. Do not put dates in the query text; the date filter is applied separately.`
      : '';

  return `You are planning literature retrieval for a scientific research question.

QUESTION: ${question}${dateNote}

Produce between ${MIN_QUERIES} and ${MAX_QUERIES} sub-queries.

RULE 1 — Decompose by facet, not by rephrasing.
Each sub-query must target a DIFFERENT aspect of the question. Three wordings of
the same question is a failure. For "does semaglutide preserve muscle mass in
older adults", good facets are: trial outcomes on body composition; the
mechanism by which GLP-1 agonists affect lean mass; and comparator agents such
as tirzepatide. Bad facets are: "semaglutide muscle mass elderly", "does
semaglutide preserve muscle in old people", "semaglutide lean mass older
adults".

RULE 2 — Route each sub-query to the sources that will actually hold the answer.
  Clinical / medical  → valyu/valyu-pubmed, valyu/valyu-clinical-trials
  Preprints, fast-moving biology → valyu/valyu-biorxiv, valyu/valyu-medrxiv
  ML, CS, physics, maths → valyu/valyu-arxiv, web
  Chemistry, drug discovery → valyu/valyu-chembl, valyu/valyu-pubchem, valyu/valyu-chemrxiv
  Drug safety / labelling → valyu/valyu-drug-labels, valyu/valyu-openfda-drug-events
  Applied or industrial → valyu/valyu-patents
  Anything general → web
Choose only from: ${ALLOWED_SOURCES.join(', ')}
Prefer one or two sources per sub-query. Use "web" on its own rather than
alongside a dataset — mixing them dilutes a targeted corpus search with general
web results. Patents cost roughly eight times what
arXiv or PubMed do, so route there only when the question is genuinely about
applied or commercial work.

RULE 3 — Query syntax.
Natural-language keywords only. No boolean operators, no site: filters, no
quoted phrases. Keep each query under 15 words.

RULE 4 — The rationale is read by a human in the interface. One sentence saying
what this facet contributes to answering the question.

Return JSON only.`;
}

interface RawPlan {
  queries?: unknown;
}

/**
 * Parses and sanitises a plan response.
 *
 * Kept pure and separate from the model call so the failure modes that matter —
 * too few queries, a hallucinated source, a boolean operator that Valyu would
 * reject — are testable without spending a model call to reproduce them.
 */
export function parsePlanResponse(raw: unknown): PlannedQuery[] {
  const queries = (raw as RawPlan | null)?.queries;
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error('planner returned no sub-queries');
  }

  const cleaned: PlannedQuery[] = [];

  for (const entry of queries.slice(0, MAX_QUERIES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;

    const text = typeof e['query'] === 'string' ? e['query'] : '';
    const query = text.replace(BANNED_OPERATORS, ' ').replace(/\s+/g, ' ').trim();
    if (query === '') continue;

    const requested = Array.isArray(e['includedSources'])
      ? (e['includedSources'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

    // Drop anything outside the verified list rather than letting a
    // hallucinated slug fail silently at retrieval time.
    const includedSources = requested.filter((s) =>
      (ALLOWED_SOURCES as readonly string[]).includes(s),
    );

    cleaned.push({
      query,
      includedSources: includedSources.length > 0 ? includedSources : FALLBACK_SOURCES,
      rationale: typeof e['rationale'] === 'string' ? e['rationale'] : '',
      resultCount: 0,
    });
  }

  if (cleaned.length === 0) throw new Error('planner returned no usable sub-queries');
  return cleaned;
}

export async function planQueries(
  gemini: GeminiClient,
  question: string,
  dateRange?: DateRange,
): Promise<PlannedQuery[]> {
  const raw = await gemini.generateJson<RawPlan>({
    tier: 'flash',
    prompt: buildPlanPrompt(question, dateRange),
    responseSchema: PLAN_SCHEMA,
    // Generous, because this budget covers reasoning tokens too. The planning
    // prompt is long and drove reasoning past 2048 on its own, truncating the
    // JSON mid-object.
    maxOutputTokens: 8192,
    thinkingBudget: 2048,
    // Some variety across facets is useful; determinism is not the goal here.
    temperature: 0.4,
  });

  return parsePlanResponse(raw);
}
