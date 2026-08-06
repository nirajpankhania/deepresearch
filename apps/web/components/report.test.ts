import { describe, expect, it } from 'vitest';

import { linkCitations, splitReport } from './report';

describe('splitReport', () => {
  it('drops the generated sources list, which the cards replace', () => {
    const md = 'Body text [1].\n\n## Sources\n\n1. [A](https://a)\n';
    expect(splitReport(md)).toBe('Body text [1].');
  });

  it('leaves a report with no sources section untouched', () => {
    expect(splitReport('Just body text.')).toBe('Just body text.');
  });

  it('does not split on the words appearing mid-sentence', () => {
    const md = 'We consulted several sources for this.';
    expect(splitReport(md)).toBe(md);
  });

  it('does not split on a deeper heading of the same name', () => {
    const md = 'Body.\n\n### Sources of error\n\nMore body.';
    expect(splitReport(md)).toContain('More body.');
  });
});

describe('linkCitations', () => {
  it('links a single citation to its source card', () => {
    expect(linkCitations('A claim [1].', 5)).toBe('A claim [\\[1\\]](#source-1).');
  });

  it('links each member of a grouped citation', () => {
    expect(linkCitations('A claim [1, 3].', 5)).toBe(
      'A claim [\\[1\\]](#source-1)[\\[3\\]](#source-3).',
    );
  });

  it('leaves a citation beyond the corpus as plain text rather than linking nowhere', () => {
    expect(linkCitations('A claim [9].', 5)).toBe('A claim [9].');
  });

  it('links only the valid members of a mixed group', () => {
    expect(linkCitations('A claim [2, 99].', 5)).toBe('A claim [\\[2\\]](#source-2).');
  });

  it('ignores bracketed text that is not a citation', () => {
    expect(linkCitations('See [the appendix] for detail.', 5)).toBe(
      'See [the appendix] for detail.',
    );
  });

  it('escapes the brackets so the renderer shows them as literal text', () => {
    // Without escaping, `[[1]](#source-1)` is ambiguous in Markdown and renders
    // as a stray bracket around a link.
    expect(linkCitations('A [1].', 3)).toContain('\\[1\\]');
  });

  it('handles a report with no citations', () => {
    expect(linkCitations('Nothing cited here.', 5)).toBe('Nothing cited here.');
  });
});
