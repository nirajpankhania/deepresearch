import { describe, expect, it } from 'vitest';

import {
  extractArxivId,
  extractNctId,
  extractPubmedId,
  firstAuthorKey,
  normaliseDoi,
  normaliseTitle,
  normaliseUrl,
} from './identifiers.js';

describe('normaliseDoi', () => {
  // Valyu returns DOIs in different shapes depending on the source: arXiv gives
  // a resolver URL, PubMed gives a bare DOI. Matching them requires one form.
  it.each([
    ['https://doi.org/10.1007/s13668-026-00777-x', '10.1007/s13668-026-00777-x'],
    ['http://dx.doi.org/10.1007/S13668-026-00777-X', '10.1007/s13668-026-00777-x'],
    ['doi:10.1007/s13668-026-00777-x', '10.1007/s13668-026-00777-x'],
    ['  10.1007/s13668-026-00777-x  ', '10.1007/s13668-026-00777-x'],
    ['https://doi.org/10.48550/arxiv.2002.04160', '10.48550/arxiv.2002.04160'],
  ])('normalises %s', (raw, expected) => {
    expect(normaliseDoi(raw)).toBe(expected);
  });

  it.each([undefined, '', '   ', 'not-a-doi', 'https://example.com/paper'])(
    'returns undefined for %s',
    (raw) => {
      expect(normaliseDoi(raw)).toBeUndefined();
    },
  );
});

describe('extractArxivId', () => {
  it('reads the id from an abs URL', () => {
    expect(extractArxivId('https://arxiv.org/abs/2002.04160')).toBe('2002.04160');
  });

  it('strips a version suffix so v1 and v2 are the same work', () => {
    expect(extractArxivId('https://arxiv.org/abs/2002.04160v3')).toBe('2002.04160');
  });

  it('reads the id from a pdf URL', () => {
    expect(extractArxivId('https://arxiv.org/pdf/2002.04160')).toBe('2002.04160');
  });

  it('reads the id out of an arXiv DOI', () => {
    expect(extractArxivId(undefined, '10.48550/arxiv.2002.04160')).toBe('2002.04160');
  });

  it('handles old-style ids with a subject class', () => {
    expect(extractArxivId('https://arxiv.org/abs/cs/0301012')).toBe('cs/0301012');
  });

  it('returns undefined for a non-arXiv URL', () => {
    expect(extractArxivId('https://pubmed.ncbi.nlm.nih.gov/12345678')).toBeUndefined();
  });
});

describe('extractPubmedId', () => {
  it('reads a bare PMID', () => {
    expect(extractPubmedId('https://pubmed.ncbi.nlm.nih.gov/12345678')).toEqual({
      kind: 'pmid',
      value: '12345678',
    });
  });

  // Valyu's PubMed rows frequently carry a PMC id rather than a PMID. They are
  // different identifier spaces and must not be conflated.
  it('reads a PMC id and labels it as such', () => {
    expect(extractPubmedId('https://pubmed.ncbi.nlm.nih.gov/PMC13272609')).toEqual({
      kind: 'pmc',
      value: 'PMC13272609',
    });
  });

  it('returns undefined for other URLs', () => {
    expect(extractPubmedId('https://arxiv.org/abs/2002.04160')).toBeUndefined();
  });
});

describe('extractNctId', () => {
  it('reads the id from a clinicaltrials.gov URL', () => {
    expect(extractNctId('https://clinicaltrials.gov/study/NCT07702461')).toBe('NCT07702461');
  });

  it('reads a bare id, which is how Valyu returns it', () => {
    expect(extractNctId(undefined, 'NCT07702461')).toBe('NCT07702461');
  });

  it('returns undefined when absent', () => {
    expect(extractNctId('https://arxiv.org/abs/2002.04160', 'abc:123')).toBeUndefined();
  });
});

describe('normaliseUrl', () => {
  it('strips protocol, www, query and trailing slash', () => {
    expect(normaliseUrl('https://www.Example.com/Paper/?utm_source=x&ref=y')).toBe(
      'example.com/paper',
    );
  });

  it('treats http and https as the same resource', () => {
    expect(normaliseUrl('http://example.com/a')).toBe(normaliseUrl('https://example.com/a'));
  });

  it('preserves path case sensitivity below the host only where it matters', () => {
    // Hosts are case-insensitive; paths are lowercased too, which is a
    // deliberate over-normalisation to catch more duplicates.
    expect(normaliseUrl('https://EXAMPLE.com/ABC')).toBe('example.com/abc');
  });

  it('passes through a malformed URL rather than throwing', () => {
    expect(normaliseUrl('not a url')).toBe('not a url');
  });
});

describe('normaliseTitle', () => {
  it('collapses case, punctuation and whitespace', () => {
    expect(normaliseTitle('GLP-1 Receptor Agonists:  A Scoping Review!')).toBe(
      'glp 1 receptor agonists a scoping review',
    );
  });

  it('matches a preprint title against its published form', () => {
    const preprint = normaliseTitle('Attention Is All You Need');
    const published = normaliseTitle('Attention is all you need.');
    expect(preprint).toBe(published);
  });
});

describe('firstAuthorKey', () => {
  it('uses the surname of the first author', () => {
    expect(firstAuthorKey(['Hilal Simsek', 'Asli Ucar'])).toBe('simsek');
  });

  it('handles a "Surname, Given" ordering', () => {
    expect(firstAuthorKey(['Simsek, Hilal'])).toBe('simsek');
  });

  it('returns undefined when there are no authors, as for clinical trials', () => {
    expect(firstAuthorKey(undefined)).toBeUndefined();
    expect(firstAuthorKey([])).toBeUndefined();
  });
});
