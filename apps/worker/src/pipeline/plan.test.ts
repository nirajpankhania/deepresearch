import { describe, expect, it } from 'vitest';

import { MAX_QUERIES, buildPlanPrompt, parsePlanResponse } from './plan.js';

const valid = {
  query: 'semaglutide body composition randomised trial older adults',
  includedSources: ['valyu/valyu-pubmed'],
  rationale: 'Trial outcomes are the primary evidence.',
};

describe('parsePlanResponse', () => {
  it('accepts a well-formed plan', () => {
    const out = parsePlanResponse({ queries: [valid, valid, valid] });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      query: valid.query,
      includedSources: ['valyu/valyu-pubmed'],
      resultCount: 0,
    });
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a non-array queries field', { queries: 'nope' }],
    ['an empty array', { queries: [] }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parsePlanResponse(raw)).toThrow();
  });

  it('rejects a plan whose entries are all unusable', () => {
    expect(() => parsePlanResponse({ queries: [{ query: '   ' }, null, 42] })).toThrow();
  });

  it('caps the number of sub-queries', () => {
    const out = parsePlanResponse({ queries: Array.from({ length: 12 }, () => valid) });
    expect(out).toHaveLength(MAX_QUERIES);
  });

  it('skips malformed entries but keeps the usable ones', () => {
    const out = parsePlanResponse({ queries: [valid, null, { rationale: 'no query' }, valid] });
    expect(out).toHaveLength(2);
  });

  describe('query sanitisation', () => {
    // Valyu rejects these outright, so a query carrying one is a wasted call.
    it.each([
      ['semaglutide AND sarcopenia', 'semaglutide sarcopenia'],
      ['semaglutide OR tirzepatide', 'semaglutide tirzepatide'],
      ['muscle NOT cardiac', 'muscle cardiac'],
      ['site:pubmed.gov semaglutide', 'pubmed.gov semaglutide'],
      ['"lean body mass" semaglutide', 'lean body mass semaglutide'],
    ])('strips operators from %s', (input, expected) => {
      const out = parsePlanResponse({ queries: [{ ...valid, query: input }] });
      expect(out[0]?.query).toBe(expected);
    });

    it('collapses the whitespace left behind', () => {
      const out = parsePlanResponse({ queries: [{ ...valid, query: 'a   AND   b' }] });
      expect(out[0]?.query).toBe('a b');
    });
  });

  describe('source routing', () => {
    it('drops a hallucinated dataset slug', () => {
      const out = parsePlanResponse({
        queries: [{ ...valid, includedSources: ['valyu/valyu-pubmed', 'valyu/not-a-real-dataset'] }],
      });
      expect(out[0]?.includedSources).toEqual(['valyu/valyu-pubmed']);
    });

    it('falls back to a safe default when every source is invalid', () => {
      const out = parsePlanResponse({
        queries: [{ ...valid, includedSources: ['valyu/made-up', 'nonsense'] }],
      });
      expect(out[0]?.includedSources).toEqual(['valyu/valyu-arxiv', 'web']);
    });

    it('falls back when the sources field is missing entirely', () => {
      const out = parsePlanResponse({ queries: [{ query: 'a real query', rationale: 'x' }] });
      expect(out[0]?.includedSources).toEqual(['valyu/valyu-arxiv', 'web']);
    });
  });

  it('tolerates a missing rationale rather than failing the task', () => {
    const out = parsePlanResponse({ queries: [{ query: 'a real query', includedSources: ['web'] }] });
    expect(out[0]?.rationale).toBe('');
  });
});

describe('buildPlanPrompt', () => {
  it('includes the question', () => {
    expect(buildPlanPrompt('Does X cause Y?')).toContain('Does X cause Y?');
  });

  it('mentions the date restriction when one is set, without putting it in the query text', () => {
    const p = buildPlanPrompt('Does X cause Y?', { start: '2020-01-01' });
    expect(p).toContain('2020-01-01');
    expect(p).toMatch(/date filter is applied separately/i);
  });

  it('says nothing about dates when none is set', () => {
    expect(buildPlanPrompt('Does X cause Y?')).not.toMatch(/restricted results/i);
  });

  it('constrains the model to the verified source list', () => {
    const p = buildPlanPrompt('Does X cause Y?');
    expect(p).toContain('valyu/valyu-clinical-trials');
    expect(p).toMatch(/Choose only from/);
  });
});
