import type { EvidenceType, Source } from '@deepresearch/shared';

/**
 * How the corpus is ordered, and which sources survive the cap.
 *
 * Split out from the model call because both decisions are arithmetic and
 * allocation — the interesting, checkable parts — while the model's job is only
 * to judge three properties of each source. Keeping them apart means the ranking
 * rules are testable without spending a model call to reproduce them.
 */

/**
 * Weight per study design, for the question this tool is asked: *what does the
 * evidence show?*
 *
 * The ordering is the conventional evidence hierarchy, with one entry that
 * matters more than the rest: a **protocol** describes a study that has not
 * reported. Valyu's clinical-trials corpus is full of them, they look highly
 * relevant on title and abstract, and treating one as evidence of an effect is
 * the single most misleading thing this pipeline could do.
 */
export const EVIDENCE_WEIGHT: Record<EvidenceType, number> = {
  'meta-analysis': 1.0,
  rct: 0.9,
  observational: 0.65,
  review: 0.55,
  'in-vitro': 0.45,
  modelling: 0.4,
  'case-report': 0.3,
  protocol: 0.2,
  other: 0.5,
};

/**
 * Weights for the composite.
 *
 * Topical relevance dominates — a rigorous study of the wrong question is still
 * the wrong question — but not so heavily that design and directness cannot
 * separate sources the model rates as equally on-topic, which was the whole
 * problem: a four-point relevance scale produced three distinct values across
 * twenty sources, leaving most of the ordering to chance.
 */
const WEIGHTS = { topical: 0.55, evidence: 0.25, directness: 0.2 } as const;

/**
 * Preprints are discounted slightly, not penalised.
 *
 * They are legitimate and often the only current evidence in a fast-moving
 * field; they simply have not been reviewed. A large discount would defeat the
 * point of searching bioRxiv and medRxiv at all.
 */
const PREPRINT_MULTIPLIER = 0.95;

const PREPRINT_DATASETS = new Set([
  'valyu/valyu-arxiv',
  'valyu/valyu-biorxiv',
  'valyu/valyu-medrxiv',
  'valyu/valyu-chemrxiv',
]);

/** Derived from the corpus rather than asked of the model: deterministic and free. */
export function isPreprint(source: Pick<Source, 'dataset'>): boolean {
  return source.dataset !== undefined && PREPRINT_DATASETS.has(source.dataset);
}

export interface Judgement {
  topical: number;
  directness: number;
  evidenceType: EvidenceType;
}

/** Composite score, 0-1. */
export function scoreSource(source: Pick<Source, 'dataset'>, judgement: Judgement): number {
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));

  const composite =
    clamp(judgement.topical) * WEIGHTS.topical +
    (EVIDENCE_WEIGHT[judgement.evidenceType] ?? EVIDENCE_WEIGHT.other) * WEIGHTS.evidence +
    clamp(judgement.directness) * WEIGHTS.directness;

  const adjusted = composite * (isPreprint(source) ? PREPRINT_MULTIPLIER : 1);
  return Math.round(adjusted * 1000) / 1000;
}

/**
 * Selects the final corpus, guaranteeing every facet is represented.
 *
 * Pure score ordering silently deletes facets. Observed on real tasks: a
 * sub-query that retrieved ten results contributed **zero** sources to the
 * report, and three others were cut to one. The planner decomposes a question
 * into facets precisely so mechanism, outcomes and comparators are all covered;
 * letting the ranker collapse one to nothing means the report quietly answers a
 * narrower question than the one asked, and nothing surfaces that.
 *
 * So each facet that retrieved anything gets a floor of slots first, and the
 * remainder go to the best sources regardless of origin. The floor is small: it
 * protects coverage without letting a weak facet crowd out a strong one.
 */
export function selectWithFacetCoverage(
  sources: Source[],
  limit: number,
  minPerFacet = 2,
): Source[] {
  const byScore = (a: Source, b: Source): number => (b.rerankScore ?? 0) - (a.rerankScore ?? 0);
  const ranked = [...sources].sort(byScore);
  if (ranked.length <= limit) return ranked;

  const facets = new Map<number, Source[]>();
  for (const source of ranked) {
    const facet = source.fromQueryIndex ?? -1;
    const bucket = facets.get(facet);
    if (bucket) bucket.push(source);
    else facets.set(facet, [source]);
  }

  const chosen = new Set<Source>();

  // Reserve the floor for each facet, in facet order so allocation does not
  // depend on which facet happened to return the single best source.
  for (const facet of [...facets.keys()].sort((a, b) => a - b)) {
    for (const source of (facets.get(facet) ?? []).slice(0, minPerFacet)) {
      if (chosen.size >= limit) break;
      chosen.add(source);
    }
  }

  // Fill the rest purely by score.
  for (const source of ranked) {
    if (chosen.size >= limit) break;
    chosen.add(source);
  }

  return [...chosen].sort(byScore);
}
