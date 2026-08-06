import { describe, expect, it } from 'vitest';
import type { Source } from '@deepresearch/shared';

import { extractClaims, parseGroundingResponse, splitSentences } from './ground.js';

const sources: Source[] = [
  { id: 'doi:10.1/a', title: 'A', url: 'https://a' },
  { id: 'doi:10.1/b', title: 'B', url: 'https://b' },
  { id: 'doi:10.1/c', title: 'C', url: 'https://c' },
];

describe('splitSentences', () => {
  it('splits on sentence boundaries', () => {
    expect(splitSentences('First sentence. Second sentence.')).toEqual([
      'First sentence.',
      'Second sentence.',
    ]);
  });

  // Scientific prose is full of these, and splitting on them produces fragments
  // that no model can sensibly verify.
  it.each([
    ['Semaglutide 2.4 mg was used. It worked.', 2],
    ['Studies by Smith et al. found no effect. Others disagree.', 2],
    ['Weight fell by 14.9% overall. Lean mass fell too.', 2],
    ['Some agents, e.g. liraglutide, differ. This matters.', 2],
    ['Trials were small, i.e. under 50 people. Power was low.', 2],
    ['See Fig. 3 for detail. The trend is clear.', 2],
  ])('does not split inside %s', (text, expected) => {
    expect(splitSentences(text)).toHaveLength(expected);
  });

  it('handles question and exclamation marks', () => {
    expect(splitSentences('Does it work? Yes it does.')).toHaveLength(2);
  });

  it('ignores markdown headings and list markers', () => {
    const md = '## A heading\n\nA real sentence here [1].';
    const out = splitSentences(md);
    expect(out.some((s) => s.includes('heading'))).toBe(false);
  });

  it('returns nothing for empty input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n\n  ')).toEqual([]);
  });

  it('keeps a trailing sentence with no terminator', () => {
    expect(splitSentences('One. Two without a full stop')).toHaveLength(2);
  });
});

describe('extractClaims', () => {
  it('keeps only citation-bearing sentences', () => {
    const report = 'An uncited assertion. A cited claim [1]. Another uncited one.';
    const claims = extractClaims(report, sources);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.sentence).toBe('A cited claim [1].');
  });

  it('maps citation numbers to stable source ids', () => {
    const claims = extractClaims('A claim [2].', sources);
    expect(claims[0]?.citedSourceIds).toEqual(['doi:10.1/b']);
  });

  it('handles grouped citations', () => {
    const claims = extractClaims('A claim [1, 3].', sources);
    expect(claims[0]?.citedSourceIds).toEqual(['doi:10.1/a', 'doi:10.1/c']);
  });

  it('deduplicates a source cited twice in one sentence', () => {
    const claims = extractClaims('A claim [1] and again [1].', sources);
    expect(claims[0]?.citedSourceIds).toEqual(['doi:10.1/a']);
  });

  it('drops a citation pointing outside the corpus', () => {
    // Synthesis strips these already; this is the backstop.
    expect(extractClaims('A claim [9].', sources)).toHaveLength(0);
  });

  it('excludes the generated sources section', () => {
    const report = 'A claim [1].\n\n## Sources\n\n1. [A](https://a) says things [1].';
    expect(extractClaims(report, sources)).toHaveLength(1);
  });

  it('returns nothing for a report with no citations', () => {
    expect(extractClaims('Nothing cited at all.', sources)).toEqual([]);
  });
});

describe('parseGroundingResponse', () => {
  const claims = [
    { sentence: 'One [1].', citedSourceIds: ['doi:10.1/a'] },
    { sentence: 'Two [2].', citedSourceIds: ['doi:10.1/b'] },
  ];

  it('reads verdicts back onto the claims', () => {
    const out = parseGroundingResponse(
      { verdicts: [{ index: 0, verdict: 'supported', reason: 'ok' }, { index: 1, verdict: 'partial' }] },
      claims,
    );
    expect(out.claims[0]).toMatchObject({ verdict: 'supported', reason: 'ok' });
    expect(out.claims[1]?.verdict).toBe('partial');
  });

  it('counts only fully supported claims as supported', () => {
    const out = parseGroundingResponse(
      { verdicts: [{ index: 0, verdict: 'supported' }, { index: 1, verdict: 'partial' }] },
      claims,
    );
    expect(out.supportedCount).toBe(1);
    expect(out.totalCount).toBe(2);
  });

  // A claim the model did not judge must not be silently counted as verified.
  it('defaults an unjudged claim to unsupported rather than supported', () => {
    const out = parseGroundingResponse({ verdicts: [{ index: 0, verdict: 'supported' }] }, claims);
    expect(out.claims[1]?.verdict).toBe('unsupported');
    expect(out.supportedCount).toBe(1);
  });

  it('ignores an unrecognised verdict string', () => {
    const out = parseGroundingResponse({ verdicts: [{ index: 0, verdict: 'probably' }] }, claims);
    expect(out.claims[0]?.verdict).toBe('unsupported');
  });

  it('ignores indices outside the claim list', () => {
    const out = parseGroundingResponse(
      { verdicts: [{ index: 99, verdict: 'supported' }, { index: -1, verdict: 'supported' }] },
      claims,
    );
    expect(out.supportedCount).toBe(0);
  });

  it.each([null, {}, { verdicts: 'nope' }])('survives a malformed response %o', (raw) => {
    const out = parseGroundingResponse(raw, claims);
    expect(out.totalCount).toBe(2);
    expect(out.supportedCount).toBe(0);
  });

  it('reports per-claim mode', () => {
    expect(parseGroundingResponse({ verdicts: [] }, claims).mode).toBe('per-claim');
  });
});
