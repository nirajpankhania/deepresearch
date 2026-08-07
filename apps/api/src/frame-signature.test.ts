import { describe, expect, it } from 'vitest';
import type { Task } from '@deepresearch/shared';

import { forStream, frameSignature } from './stream.js';

const base: Task = {
  id: 't1',
  question: 'A question long enough to be valid',
  status: 'running',
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:00:10.000Z',
  attempt: 1,
  leaseExpiresAt: '2026-08-07T12:15:00.000Z',
  progress: { step: 'synthesising', message: 'Writing report from 20 sources', pct: 85 },
  queries: [{ query: 'q', includedSources: ['web'], rationale: 'r', resultCount: 10, done: true }],
  sources: [{ id: 's1', title: 'A', url: 'https://a', snippet: 'x'.repeat(5000) }],
  cost: { totalUsd: 0.02, txIds: ['tx'] },
};

describe('forStream', () => {
  it('strips source snippets, which were 83% of every frame', () => {
    const out = forStream(base);
    expect(out.sources[0]).not.toHaveProperty('snippet');
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(base).length / 4);
  });

  it('keeps the metadata the cards actually render', () => {
    expect(forStream(base).sources[0]).toMatchObject({ id: 's1', title: 'A', url: 'https://a' });
  });
});

describe('frameSignature', () => {
  // The bug this exists to prevent: comparing serialised documents looked
  // equivalent but Firestore does not guarantee map field ordering between
  // snapshots, so identical documents compared unequal and the delta path
  // never fired.
  it('ignores timestamps, which every draft publish updates', () => {
    const later: Task = {
      ...base,
      updatedAt: '2026-08-07T12:00:20.000Z',
      leaseExpiresAt: '2026-08-07T12:20:00.000Z',
    };
    expect(frameSignature(later)).toBe(frameSignature(base));
  });

  it('ignores the draft itself, so a growing report is not a full change', () => {
    expect(frameSignature({ ...base, reportDraft: 'half a report' })).toBe(frameSignature(base));
  });

  it('ignores source snippet contents, which nothing renders', () => {
    const swapped: Task = {
      ...base,
      sources: [{ ...base.sources[0]!, snippet: 'completely different text' }],
    };
    expect(frameSignature(swapped)).toBe(frameSignature(base));
  });

  it.each([
    ['status', { status: 'completed' as const }],
    ['stage', { progress: { ...base.progress, step: 'grounding' as const } }],
    ['progress message', { progress: { ...base.progress, message: 'Checking claims' } }],
    ['source count', { sources: [] }],
    ['the finished report appearing', { report: '# Report' }],
    ['measured cost', { cost: { totalUsd: 0.05, txIds: ['tx'] } }],
    ['an error', { error: { message: 'boom', stage: 'planning' as const } }],
  ])('treats a change of %s as needing a full frame', (_label, patch) => {
    expect(frameSignature({ ...base, ...patch } as Task)).not.toBe(frameSignature(base));
  });

  it('treats a sub-query completing as needing a full frame', () => {
    const done: Task = {
      ...base,
      queries: [{ ...base.queries[0]!, resultCount: 8, costUsd: 0.004 }],
    };
    expect(frameSignature(done)).not.toBe(frameSignature(base));
  });

  it('treats grounding arriving as needing a full frame', () => {
    const grounded: Task = {
      ...base,
      grounding: { claims: [], supportedCount: 0, totalCount: 12, mode: 'per-claim' },
    };
    expect(frameSignature(grounded)).not.toBe(frameSignature(base));
  });
});
