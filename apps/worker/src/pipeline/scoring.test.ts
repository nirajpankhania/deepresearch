import { describe, expect, it } from 'vitest';
import type { Source } from '@deepresearch/shared';

import { EVIDENCE_WEIGHT, isPreprint, scoreSource, selectWithFacetCoverage } from './scoring.js';

const src = (over: Partial<Source> & { id: string }): Source => ({
  title: over.id,
  url: `https://example.com/${over.id}`,
  ...over,
});

describe('isPreprint', () => {
  it.each(['valyu/valyu-arxiv', 'valyu/valyu-biorxiv', 'valyu/valyu-medrxiv', 'valyu/valyu-chemrxiv'])(
    'treats %s as a preprint server',
    (dataset) => {
      expect(isPreprint({ dataset })).toBe(true);
    },
  );

  it.each(['valyu/valyu-pubmed', 'valyu/valyu-clinical-trials', 'valyu/valyu-patents', undefined])(
    'does not treat %s as a preprint',
    (dataset) => {
      expect(isPreprint({ dataset })).toBe(false);
    },
  );
});

describe('scoreSource', () => {
  const pubmed = { dataset: 'valyu/valyu-pubmed' };

  it('separates sources the model rates equally on topic', () => {
    // The problem this exists to fix: a single relevance number produced three
    // distinct values across twenty sources, leaving most of the order to chance.
    const trial = scoreSource(pubmed, { topical: 1, directness: 1, evidenceType: 'rct' });
    const model = scoreSource(pubmed, { topical: 1, directness: 1, evidenceType: 'modelling' });
    expect(trial).toBeGreaterThan(model);
  });

  it('ranks a protocol far below a completed trial of equal topicality', () => {
    // A protocol describes a study that has not reported. Treating one as
    // evidence of an effect is the most misleading thing this pipeline could do.
    const result = scoreSource(pubmed, { topical: 1, directness: 1, evidenceType: 'rct' });
    const plan = scoreSource(pubmed, { topical: 1, directness: 1, evidenceType: 'protocol' });
    expect(result - plan).toBeGreaterThan(0.15);
  });

  it('follows the evidence hierarchy', () => {
    const at = (evidenceType: Parameters<typeof scoreSource>[1]['evidenceType']): number =>
      scoreSource(pubmed, { topical: 0.8, directness: 0.8, evidenceType });
    expect(at('meta-analysis')).toBeGreaterThan(at('rct'));
    expect(at('rct')).toBeGreaterThan(at('observational'));
    expect(at('observational')).toBeGreaterThan(at('in-vitro'));
    expect(at('in-vitro')).toBeGreaterThan(at('protocol'));
  });

  it('lets topical relevance dominate, since a rigorous answer to the wrong question is still wrong', () => {
    const onTopicWeak = scoreSource(pubmed, { topical: 1, directness: 1, evidenceType: 'modelling' });
    const offTopicStrong = scoreSource(pubmed, {
      topical: 0.2,
      directness: 0.2,
      evidenceType: 'meta-analysis',
    });
    expect(onTopicWeak).toBeGreaterThan(offTopicStrong);
  });

  it('discounts a preprint slightly rather than penalising it', () => {
    const j = { topical: 1, directness: 1, evidenceType: 'rct' as const };
    const published = scoreSource({ dataset: 'valyu/valyu-pubmed' }, j);
    const preprint = scoreSource({ dataset: 'valyu/valyu-biorxiv' }, j);
    expect(preprint).toBeLessThan(published);
    expect(preprint / published).toBeGreaterThan(0.9);
  });

  it('stays within 0 and 1', () => {
    const top = scoreSource({ dataset: 'valyu/valyu-pubmed' }, {
      topical: 1,
      directness: 1,
      evidenceType: 'meta-analysis',
    });
    const bottom = scoreSource({}, { topical: 0, directness: 0, evidenceType: 'protocol' });
    expect(top).toBeLessThanOrEqual(1);
    expect(bottom).toBeGreaterThanOrEqual(0);
  });

  it('clamps scores the model returned outside range', () => {
    const s = scoreSource({}, { topical: 5, directness: -3, evidenceType: 'rct' });
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the neutral weight for an unrecognised design', () => {
    const unknown = scoreSource({}, {
      topical: 0.5,
      directness: 0.5,
      evidenceType: 'nonsense' as never,
    });
    const other = scoreSource({}, { topical: 0.5, directness: 0.5, evidenceType: 'other' });
    expect(unknown).toBe(other);
  });

  it('has a weight for every evidence type', () => {
    for (const w of Object.values(EVIDENCE_WEIGHT)) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

describe('selectWithFacetCoverage', () => {
  /** Facet 0 dominates on score; facet 2 is weak but real. */
  const corpus: Source[] = [
    ...Array.from({ length: 8 }, (_, i) =>
      src({ id: `a${i}`, fromQueryIndex: 0, rerankScore: 0.9 - i * 0.01 }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      src({ id: `b${i}`, fromQueryIndex: 1, rerankScore: 0.8 - i * 0.01 }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      src({ id: `c${i}`, fromQueryIndex: 2, rerankScore: 0.3 - i * 0.01 }),
    ),
  ];

  it('returns everything when the corpus is within the cap', () => {
    const few = corpus.slice(0, 5);
    expect(selectWithFacetCoverage(few, 20)).toHaveLength(5);
  });

  // Observed on real tasks: a sub-query that retrieved ten results contributed
  // zero sources, so the report quietly answered a narrower question.
  it('never drops a facet entirely, even when it scores worst', () => {
    const out = selectWithFacetCoverage(corpus, 10);
    const facets = new Set(out.map((s) => s.fromQueryIndex));
    expect(facets).toEqual(new Set([0, 1, 2]));
  });

  it('gives each facet the floor before filling by score', () => {
    const out = selectWithFacetCoverage(corpus, 10, 2);
    const weakest = out.filter((s) => s.fromQueryIndex === 2);
    expect(weakest.length).toBeGreaterThanOrEqual(2);
  });

  it('spends the remaining slots on the best sources', () => {
    const out = selectWithFacetCoverage(corpus, 12, 2);
    // 6 reserved by the floor, 6 free — the free ones should favour facet 0.
    expect(out.filter((s) => s.fromQueryIndex === 0).length).toBeGreaterThan(2);
  });

  it('respects the cap exactly', () => {
    expect(selectWithFacetCoverage(corpus, 7)).toHaveLength(7);
  });

  it('returns results ordered by score', () => {
    const out = selectWithFacetCoverage(corpus, 10);
    const scores = out.map((s) => s.rerankScore ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('does not duplicate a source that both the floor and the fill would pick', () => {
    const out = selectWithFacetCoverage(corpus, 12);
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });

  it('handles sources with no facet recorded', () => {
    const orphans = [src({ id: 'x', rerankScore: 0.5 }), src({ id: 'y', rerankScore: 0.4 })];
    expect(selectWithFacetCoverage([...corpus, ...orphans], 10)).toHaveLength(10);
  });

  it('handles an empty corpus', () => {
    expect(selectWithFacetCoverage([], 10)).toEqual([]);
  });

  it('cannot exceed the cap when facets outnumber the slots', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      src({ id: `f${i}`, fromQueryIndex: i, rerankScore: 0.5 }),
    );
    expect(selectWithFacetCoverage(many, 5, 2)).toHaveLength(5);
  });
});
