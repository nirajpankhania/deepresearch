import { describe, expect, it } from 'vitest';

import { widenSources } from './widen.js';

describe('widenSources', () => {
  it('pairs PubMed with the preprint servers that carry the same work earlier', () => {
    const out = widenSources(['valyu/valyu-pubmed']);
    expect(out.includedSources).toContain('valyu/valyu-biorxiv');
    expect(out.includedSources).toContain('valyu/valyu-medrxiv');
  });

  it('pairs a preprint server back to the peer-reviewed corpus', () => {
    expect(widenSources(['valyu/valyu-biorxiv']).includedSources).toContain('valyu/valyu-pubmed');
  });

  // Keys must be domains. Dataset ids are accepted by the API and silently
  // ignored, which makes a wrong key look entirely correct.
  it('keys biases by domain, never by dataset id', () => {
    const { sourceBiases } = widenSources(['valyu/valyu-pubmed']);
    expect(sourceBiases).toHaveProperty('pubmed.ncbi.nlm.nih.gov');
    expect(Object.keys(sourceBiases).every((k) => !k.startsWith('valyu/'))).toBe(true);
  });

  it('boosts what the planner chose above what was added', () => {
    const { sourceBiases } = widenSources(['valyu/valyu-pubmed']);
    expect(sourceBiases['pubmed.ncbi.nlm.nih.gov']).toBeGreaterThan(0);
    expect(sourceBiases['www.biorxiv.org']).toBeLessThan(0);
  });

  it('keeps every bias inside the range the API accepts', () => {
    const { sourceBiases } = widenSources(['valyu/valyu-pubmed', 'valyu/valyu-clinical-trials']);
    for (const v of Object.values(sourceBiases)) {
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('sends no biases when there is nothing to widen', () => {
    const out = widenSources(['valyu/valyu-patents']);
    expect(out.includedSources).toEqual(['valyu/valyu-patents']);
    expect(out.sourceBiases).toEqual({});
  });

  it('leaves web-only routing alone', () => {
    expect(widenSources(['web'])).toEqual({ includedSources: ['web'], sourceBiases: {} });
  });

  it('does not duplicate a counterpart the planner already chose', () => {
    const out = widenSources(['valyu/valyu-pubmed', 'valyu/valyu-medrxiv']);
    expect(out.includedSources.filter((s) => s === 'valyu/valyu-medrxiv')).toHaveLength(1);
    // Explicitly chosen, so it is boosted rather than demoted.
    expect(out.sourceBiases['www.medrxiv.org']).toBeGreaterThan(0);
  });

  it('never drops what the planner asked for', () => {
    const primary = ['valyu/valyu-pubmed', 'valyu/valyu-clinical-trials'];
    const out = widenSources(primary);
    for (const s of primary) expect(out.includedSources).toContain(s);
  });

  it('handles an empty list', () => {
    expect(widenSources([])).toEqual({ includedSources: [], sourceBiases: {} });
  });
});
