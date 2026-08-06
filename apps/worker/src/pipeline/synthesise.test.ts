import { describe, expect, it } from 'vitest';
import type { Source } from '@deepresearch/shared';

import {
  buildSynthesisPrompt,
  extractCitedIndices,
  formatSourcesForPrompt,
  renderSourceList,
  stripInvalidCitations,
} from './synthesise.js';

const src = (over: Partial<Source> & Pick<Source, 'id' | 'title' | 'url'>): Source => ({ ...over });

const sources: Source[] = [
  src({
    id: 'a',
    title: 'Semaglutide and lean mass',
    url: 'https://pubmed.ncbi.nlm.nih.gov/1',
    authors: ['Ada Lovelace', 'Alan Turing'],
    publicationDate: '2024-01-01',
    dataset: 'valyu/valyu-pubmed',
    doi: '10.1/a',
    snippet: 'Trial content here.',
  }),
  src({ id: 'b', title: 'Mechanism paper', url: 'https://arxiv.org/abs/2401.1', arxivId: '2401.1' }),
];

describe('extractCitedIndices', () => {
  it('finds a single citation', () => {
    expect([...extractCitedIndices('A claim [1].')]).toEqual([1]);
  });

  it('finds each number inside a grouped citation', () => {
    expect([...extractCitedIndices('A claim [1, 3].')].sort()).toEqual([1, 3]);
  });

  it('handles grouped citations without spaces', () => {
    expect([...extractCitedIndices('A claim [2,4,6].')].sort()).toEqual([2, 4, 6]);
  });

  it('deduplicates repeated citations', () => {
    expect([...extractCitedIndices('One [1]. Two [1]. Three [1].')]).toEqual([1]);
  });

  it('finds nothing in an uncited report', () => {
    expect(extractCitedIndices('No citations at all.').size).toBe(0);
  });

  it('ignores bracketed text that is not a citation', () => {
    expect(extractCitedIndices('A [note] and [see below].').size).toBe(0);
  });
});

describe('stripInvalidCitations', () => {
  // A model that invents [27] against 20 sources produces a report that looks
  // cited and is not.
  it('removes a citation pointing past the corpus', () => {
    const { report, removed } = stripInvalidCitations('A claim [27].', 20);
    expect(report).toBe('A claim .');
    expect(removed).toEqual([27]);
  });

  it('keeps valid citations untouched', () => {
    const { report, removed } = stripInvalidCitations('A claim [3].', 20);
    expect(report).toBe('A claim [3].');
    expect(removed).toEqual([]);
  });

  it('prunes only the invalid members of a group', () => {
    const { report, removed } = stripInvalidCitations('A claim [2, 99].', 20);
    expect(report).toBe('A claim [2].');
    expect(removed).toEqual([99]);
  });

  it('removes a zero citation, which is never a valid source number', () => {
    const { report } = stripInvalidCitations('A claim [0].', 20);
    expect(report).toBe('A claim .');
  });

  it('leaves a report with no citations alone', () => {
    expect(stripInvalidCitations('Nothing here.', 5).report).toBe('Nothing here.');
  });
});

describe('formatSourcesForPrompt', () => {
  it('numbers sources from 1, matching the citation scheme', () => {
    const out = formatSourcesForPrompt(sources);
    expect(out).toContain('[1] Semaglutide and lean mass');
    expect(out).toContain('[2] Mechanism paper');
  });

  it('includes the metadata that determines evidential weight', () => {
    const out = formatSourcesForPrompt(sources);
    expect(out).toContain('2024-01-01');
    expect(out).toContain('valyu/valyu-pubmed');
    expect(out).toContain('DOI 10.1/a');
  });

  it('truncates content to the given budget', () => {
    const long = [src({ id: 'x', title: 'T', url: 'https://x', snippet: 'y'.repeat(5000) })];
    expect(formatSourcesForPrompt(long, 100)).toContain('y'.repeat(100));
    expect(formatSourcesForPrompt(long, 100)).not.toContain('y'.repeat(101));
  });

  it('says so when a source has no extracted content', () => {
    expect(formatSourcesForPrompt([src({ id: 'x', title: 'T', url: 'https://x' })])).toContain(
      '(no extracted content)',
    );
  });

  it('abbreviates long author lists', () => {
    const many = [
      src({ id: 'x', title: 'T', url: 'https://x', authors: ['A B', 'C D', 'E F', 'G H'] }),
    ];
    expect(formatSourcesForPrompt(many)).toContain('et al.');
  });
});

describe('renderSourceList', () => {
  it('renders every source as a working Markdown link', () => {
    const out = renderSourceList(sources);
    expect(out).toContain('1. [Semaglutide and lean mass](https://pubmed.ncbi.nlm.nih.gov/1)');
    expect(out).toContain('2. [Mechanism paper](https://arxiv.org/abs/2401.1)');
  });

  it('surfaces a merged alternate, which is often the open-access copy', () => {
    const withAlt = [
      src({
        ...sources[0]!,
        mergedAlternates: [{ url: 'https://biorxiv.org/1', mergedBy: 'title-author' }],
      }),
    ];
    expect(renderSourceList(withAlt)).toContain('https://biorxiv.org/1');
  });

  it('does not repeat an alternate identical to the primary URL', () => {
    const withAlt = [
      src({
        ...sources[0]!,
        mergedAlternates: [{ url: sources[0]!.url, mergedBy: 'doi' }],
      }),
    ];
    expect(renderSourceList(withAlt)).not.toContain('Also available');
  });
});

describe('buildSynthesisPrompt', () => {
  it('instructs the model to acknowledge gaps rather than fill them', () => {
    const p = buildSynthesisPrompt('Does X cause Y?', sources);
    expect(p).toMatch(/Do not\s+fill the gap from your own knowledge/);
  });

  it('forbids the model writing its own sources section', () => {
    expect(buildSynthesisPrompt('Q?', sources)).toMatch(/Do not write a sources or/);
  });

  it('mentions the date restriction when one was applied', () => {
    const p = buildSynthesisPrompt('Q?', sources, { start: '2021-01-01' });
    expect(p).toContain('2021-01-01');
    expect(p).toMatch(/may omit relevant older or newer work/);
  });

  it('includes the numbered sources', () => {
    expect(buildSynthesisPrompt('Q?', sources)).toContain('[1] Semaglutide and lean mass');
  });
});
