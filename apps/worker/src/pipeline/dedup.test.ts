import { describe, expect, it } from 'vitest';
import type { Source } from '@deepresearch/shared';

import { dedupeSources } from './dedup.js';

function src(over: Partial<Source> & Pick<Source, 'id' | 'title' | 'url'>): Source {
  return { relevanceScore: 0.5, ...over };
}

describe('dedupeSources', () => {
  it('leaves distinct sources alone', () => {
    const out = dedupeSources([
      src({ id: 'a', title: 'Paper A', url: 'https://example.com/a' }),
      src({ id: 'b', title: 'Paper B', url: 'https://example.com/b' }),
    ]);
    expect(out).toHaveLength(2);
  });

  describe('identifier precedence', () => {
    it('merges on DOI even when the URLs differ', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'X', url: 'https://publisher.com/x', doi: '10.1/x', relevanceScore: 0.9 }),
        src({ id: 'b', title: 'X', url: 'https://mirror.org/x', doi: '10.1/x', relevanceScore: 0.4 }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.mergedAlternates?.[0]?.mergedBy).toBe('doi');
    });

    it('merges on arXiv id when neither has a DOI', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'X', url: 'https://arxiv.org/abs/2002.04160', arxivId: '2002.04160' }),
        src({ id: 'b', title: 'X', url: 'https://arxiv.org/pdf/2002.04160', arxivId: '2002.04160' }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.mergedAlternates?.[0]?.mergedBy).toBe('arxivId');
    });

    it('merges on PMID', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'X', url: 'https://a.com', pmid: '12345678' }),
        src({ id: 'b', title: 'Y', url: 'https://b.com', pmid: '12345678' }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.mergedAlternates?.[0]?.mergedBy).toBe('pmid');
    });

    it('merges on NCT id, which is all a clinical trial has', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'Trial', url: 'https://clinicaltrials.gov/study/NCT1', nctId: 'NCT1' }),
        src({ id: 'b', title: 'Trial', url: 'https://other.gov/NCT1', nctId: 'NCT1' }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.mergedAlternates?.[0]?.mergedBy).toBe('nctId');
    });

    it('falls back to normalised URL when no identifier exists', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'X', url: 'https://www.example.com/paper/' }),
        src({ id: 'b', title: 'X', url: 'http://example.com/paper?utm_source=z' }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.mergedAlternates?.[0]?.mergedBy).toBe('url');
    });

    it('does not merge two different works that share nothing', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'X', url: 'https://a.com', doi: '10.1/x' }),
        src({ id: 'b', title: 'Y', url: 'https://b.com', doi: '10.1/y' }),
      ]);
      expect(out).toHaveLength(2);
    });
  });

  describe('preprint and published version', () => {
    // The case the brief calls out. These have DIFFERENT DOIs, so identifier
    // matching alone reports two sources. Only title-and-author catches it.
    const preprint = src({
      id: 'pre',
      title: 'Semaglutide and Muscle Mass in Older Adults',
      url: 'https://arxiv.org/abs/2401.00001',
      doi: '10.48550/arxiv.2401.00001',
      arxivId: '2401.00001',
      authors: ['Hilal Simsek', 'Asli Ucar'],
      dataset: 'valyu/valyu-arxiv',
      relevanceScore: 0.6,
    });
    const published = src({
      id: 'pub',
      title: 'Semaglutide and muscle mass in older adults.',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345678',
      doi: '10.1007/s13668-026-00777-x',
      pmid: '12345678',
      authors: ['Simsek, Hilal', 'Ucar, Asli'],
      dataset: 'valyu/valyu-pubmed',
      relevanceScore: 0.92,
    });

    it('merges them despite different DOIs', () => {
      const out = dedupeSources([preprint, published]);
      expect(out).toHaveLength(1);
      expect(out[0]?.mergedAlternates?.[0]?.mergedBy).toBe('title-author');
    });

    it('keeps the higher-scoring version', () => {
      const out = dedupeSources([preprint, published]);
      expect(out[0]?.id).toBe('pub');
    });

    it('keeps the higher-scoring version regardless of input order', () => {
      const out = dedupeSources([published, preprint]);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('pub');
    });

    it('records the discarded version rather than dropping it', () => {
      const alt = dedupeSources([preprint, published])[0]?.mergedAlternates?.[0];
      expect(alt).toMatchObject({
        url: preprint.url,
        doi: preprint.doi,
        dataset: 'valyu/valyu-arxiv',
      });
    });

    it('does not merge same-title works by different authors', () => {
      const other = src({
        ...published,
        id: 'other',
        authors: ['Zhang, Wei'],
        doi: '10.9/other',
        pmid: '99999999',
        url: 'https://pubmed.ncbi.nlm.nih.gov/99999999',
      });
      expect(dedupeSources([preprint, other])).toHaveLength(2);
    });

    it('does not merge on title alone when authors are absent', () => {
      // Clinical trials have no authors. Merging them on title would be wrong:
      // distinct trials routinely share a title.
      const t1 = src({ id: 't1', title: 'A Study of Semaglutide', url: 'https://x.gov/NCT1', nctId: 'NCT1' });
      const t2 = src({ id: 't2', title: 'A Study of Semaglutide', url: 'https://x.gov/NCT2', nctId: 'NCT2' });
      expect(dedupeSources([t1, t2])).toHaveLength(2);
    });
  });

  describe('merging across more than two copies', () => {
    it('collapses a chain into one record with two alternates', () => {
      const out = dedupeSources([
        src({ id: 'a', title: 'X', url: 'https://a.com', doi: '10.1/x', relevanceScore: 0.3 }),
        src({ id: 'b', title: 'X', url: 'https://b.com', doi: '10.1/x', relevanceScore: 0.8 }),
        src({ id: 'c', title: 'X', url: 'https://c.com', doi: '10.1/x', relevanceScore: 0.5 }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('b');
      expect(out[0]?.mergedAlternates).toHaveLength(2);
    });
  });

  describe('chunked documents', () => {
    // Valyu splits a long document into several results (ids look like
    // `uuid:PMC12592101:3`). They share a DOI and URL, so they dedup correctly —
    // but keeping only one chunk's text would discard most of the article.
    const chunk = (n: number, text: string): Source =>
      src({
        id: `c${n}`,
        title: 'Musculoskeletal risks of GLP-1 therapy',
        url: 'https://pubmed.ncbi.nlm.nih.gov/PMC12592101',
        doi: '10.3389/fragi.2025.1640030',
        snippet: text,
        relevanceScore: 0.9,
      });

    it('rejoins chunk text rather than discarding it', () => {
      const out = dedupeSources([
        chunk(1, 'First part of the article.'),
        chunk(2, 'Second part of the article.'),
        chunk(3, 'Third part of the article.'),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]?.snippet).toContain('First part');
      expect(out[0]?.snippet).toContain('Second part');
      expect(out[0]?.snippet).toContain('Third part');
    });

    it('drops exactly repeated chunks', () => {
      const out = dedupeSources([chunk(1, 'Same text.'), chunk(2, 'Same text.')]);
      expect(out[0]?.snippet).toBe('Same text.');
    });

    it('bounds the rejoined length', () => {
      const out = dedupeSources(
        Array.from({ length: 20 }, (_, i) => chunk(i, `${'x'.repeat(2000)}${i}`)),
      );
      expect((out[0]?.snippet ?? '').length).toBeLessThanOrEqual(12_000);
    });

    it('keeps the winning rendition’s own text when merging on title and author', () => {
      // The preprint's chunks must not travel with the published version.
      const preprint = src({
        id: 'pre',
        title: 'A Study of Semaglutide',
        url: 'https://biorxiv.org/1',
        doi: '10.1101/pre',
        authors: ['Ada Lovelace'],
        snippet: 'PREPRINT TEXT',
        relevanceScore: 0.4,
      });
      const published = src({
        id: 'pub',
        title: 'A study of semaglutide.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/1',
        doi: '10.1/pub',
        authors: ['Lovelace, Ada'],
        snippet: 'PUBLISHED TEXT',
        relevanceScore: 0.9,
      });

      const out = dedupeSources([preprint, published]);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('pub');
      expect(out[0]?.snippet).toBe('PUBLISHED TEXT');
      expect(out[0]?.snippet).not.toContain('PREPRINT');
    });

    it('keeps the winner’s text regardless of input order', () => {
      const lo = src({ id: 'lo', title: 'T', url: 'https://a/1', doi: '10.1/a', authors: ['X Y'], snippet: 'LOW', relevanceScore: 0.2 });
      const hi = src({ id: 'hi', title: 'T', url: 'https://b/1', doi: '10.1/b', authors: ['X Y'], snippet: 'HIGH', relevanceScore: 0.8 });
      expect(dedupeSources([hi, lo])[0]?.snippet).toBe('HIGH');
      expect(dedupeSources([lo, hi])[0]?.snippet).toBe('HIGH');
    });
  });

  it('handles an empty input', () => {
    expect(dedupeSources([])).toEqual([]);
  });
});
