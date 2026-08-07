import { describe, expect, it } from 'vitest';

import { parseJudgements, parseReasons } from './rerank.js';

const ok = { index: 0, topical: 80, directness: 60, evidence: 'rct', reason: 'Reports results.' };

describe('parseJudgements', () => {
  it('reads a well-formed judgement and normalises to 0-1', () => {
    const out = parseJudgements({ judgements: [ok] }, 3);
    expect(out.get(0)).toEqual({ topical: 0.8, directness: 0.6, evidenceType: 'rct' });
  });

  it.each([
    ['a null response', null],
    ['a missing field', {}],
    ['a non-array', { judgements: 'nope' }],
  ])('returns nothing usable for %s', (_label, raw) => {
    expect(parseJudgements(raw, 3).size).toBe(0);
  });

  // Dropped rather than defaulted: a source the model failed to judge should
  // fall back to its retrieval score, not be assumed excellent.
  it('drops an index outside the corpus', () => {
    expect(parseJudgements({ judgements: [{ ...ok, index: 99 }] }, 3).size).toBe(0);
    expect(parseJudgements({ judgements: [{ ...ok, index: -1 }] }, 3).size).toBe(0);
  });

  it('drops an entry with a missing score rather than assuming one', () => {
    expect(parseJudgements({ judgements: [{ index: 0, evidence: 'rct' }] }, 3).size).toBe(0);
  });

  it('falls back to "other" for an unrecognised design, keeping the scores', () => {
    const out = parseJudgements({ judgements: [{ ...ok, evidence: 'quasi-experimental' }] }, 3);
    expect(out.get(0)?.evidenceType).toBe('other');
    expect(out.get(0)?.topical).toBe(0.8);
  });

  it('clamps scores outside 0-100', () => {
    const out = parseJudgements({ judgements: [{ ...ok, topical: 500, directness: -20 }] }, 3);
    expect(out.get(0)?.topical).toBe(1);
    expect(out.get(0)?.directness).toBe(0);
  });

  it('rejects non-finite scores', () => {
    expect(parseJudgements({ judgements: [{ ...ok, topical: Number.NaN }] }, 3).size).toBe(0);
  });

  it('keeps the good entries alongside malformed ones', () => {
    const out = parseJudgements({ judgements: [ok, null, { index: 'x' }, { ...ok, index: 2 }] }, 3);
    expect([...out.keys()].sort()).toEqual([0, 2]);
  });

  it('accepts every documented evidence type', () => {
    const types = ['meta-analysis','rct','observational','review','in-vitro','modelling','case-report','protocol','other'];
    for (const evidence of types) {
      const out = parseJudgements({ judgements: [{ ...ok, evidence }] }, 1);
      expect(out.get(0)?.evidenceType).toBe(evidence);
    }
  });
});

describe('parseReasons', () => {
  it('reads a reason', () => {
    expect(parseReasons({ judgements: [ok] }, 3).get(0)).toBe('Reports results.');
  });

  it('omits an empty or missing reason rather than storing a blank', () => {
    expect(parseReasons({ judgements: [{ ...ok, reason: '   ' }] }, 3).size).toBe(0);
    expect(parseReasons({ judgements: [{ index: 0, topical: 1, directness: 1 }] }, 3).size).toBe(0);
  });

  it('survives a malformed response', () => {
    expect(parseReasons(null, 3).size).toBe(0);
  });
});
