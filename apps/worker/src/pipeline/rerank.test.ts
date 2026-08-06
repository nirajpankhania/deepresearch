import { describe, expect, it } from 'vitest';

import { parseRerankResponse } from './rerank.js';

describe('parseRerankResponse', () => {
  it('reads well-formed scores', () => {
    const out = parseRerankResponse({ scores: [{ index: 0, score: 0.9 }, { index: 1, score: 0.2 }] }, 2);
    expect(out.get(0)).toBe(0.9);
    expect(out.get(1)).toBe(0.2);
  });

  it.each([
    ['a null response', null],
    ['a missing scores field', {}],
    ['a non-array scores field', { scores: 'nope' }],
  ])('returns nothing usable for %s', (_label, raw) => {
    expect(parseRerankResponse(raw, 5).size).toBe(0);
  });

  it('discards indices outside the corpus, which would otherwise misattribute scores', () => {
    const out = parseRerankResponse({ scores: [{ index: 99, score: 1 }, { index: -1, score: 1 }] }, 3);
    expect(out.size).toBe(0);
  });

  it('discards non-integer indices', () => {
    expect(parseRerankResponse({ scores: [{ index: 1.5, score: 1 }] }, 3).size).toBe(0);
  });

  it('clamps scores into range rather than trusting the model', () => {
    const out = parseRerankResponse({ scores: [{ index: 0, score: 7 }, { index: 1, score: -3 }] }, 2);
    expect(out.get(0)).toBe(1);
    expect(out.get(1)).toBe(0);
  });

  it('skips malformed entries but keeps the good ones', () => {
    const out = parseRerankResponse(
      { scores: [{ index: 0, score: 0.5 }, null, { index: 'x', score: 1 }, { score: 1 }] },
      3,
    );
    expect(out.size).toBe(1);
    expect(out.get(0)).toBe(0.5);
  });

  it('rejects non-finite scores', () => {
    const out = parseRerankResponse({ scores: [{ index: 0, score: Number.NaN }] }, 2);
    expect(out.size).toBe(0);
  });
});
