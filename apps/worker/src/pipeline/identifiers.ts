/**
 * Identifier extraction and normalisation.
 *
 * Deduplication is only as good as the keys it compares, and Valyu returns the
 * same identifier in different shapes depending on the source — arXiv gives a
 * DOI as a resolver URL, PubMed gives it bare. Every function here is pure, so
 * the rules are testable without touching the network.
 */

/** Strips resolver prefixes and case so DOIs from different sources compare equal. */
export function normaliseDoi(raw?: string): string | undefined {
  if (!raw) return undefined;

  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .trim();

  // Every DOI begins with the "10." registrant prefix. Anything else is a URL
  // or free text that happened to land in the field.
  return s.startsWith('10.') ? s : undefined;
}

/** Drops a trailing version marker, so v1 and v3 of a preprint are one work. */
function stripVersion(id: string): string {
  return id.replace(/v\d+$/i, '');
}

/**
 * arXiv id from a URL, or failing that from an arXiv-issued DOI.
 *
 * Handles both modern ids (`2002.04160`) and pre-2007 ids that carry a subject
 * class (`cs/0301012`).
 */
export function extractArxivId(url?: string, doi?: string): string | undefined {
  if (url) {
    const m = /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+)/i.exec(url);
    if (m?.[1]) return stripVersion(m[1].replace(/\.pdf$/i, ''));
  }

  const d = normaliseDoi(doi);
  if (d) {
    const m = /^10\.48550\/arxiv\.(.+)$/.exec(d);
    if (m?.[1]) return stripVersion(m[1]);
  }

  return undefined;
}

/**
 * PubMed identifier, labelled by kind.
 *
 * PMID and PMC are different identifier spaces and must not be conflated — a
 * PMID and a PMC id for the same article are different numbers, and treating
 * one as the other would merge unrelated records.
 */
export function extractPubmedId(
  url?: string,
): { kind: 'pmid' | 'pmc'; value: string } | undefined {
  if (!url) return undefined;

  const m = /(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc\/articles)\/(PMC\d+|\d+)/i.exec(
    url,
  );
  if (!m?.[1]) return undefined;

  const value = m[1];
  return value.toUpperCase().startsWith('PMC')
    ? { kind: 'pmc', value: value.toUpperCase() }
    : { kind: 'pmid', value };
}

/** ClinicalTrials.gov registration number, the only stable id a trial carries. */
export function extractNctId(url?: string, id?: string): string | undefined {
  const m = /\b(NCT\d{6,})\b/i.exec(`${url ?? ''} ${id ?? ''}`);
  return m?.[1]?.toUpperCase();
}

/**
 * Last-resort dedup key: host and path, with protocol, `www.`, query string and
 * trailing slash removed.
 *
 * Paths are lowercased too. That is deliberate over-normalisation — it can in
 * principle merge two case-distinct URLs on a case-sensitive server, but in
 * practice it catches far more genuine duplicates than it creates false ones.
 */
export function normaliseUrl(url: string): string {
  // Whitespace means this was never a URL; hand it back rather than guessing.
  if (/\s/.test(url.trim()) || url.trim() === '') return url;

  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return url;
  }
}

/** Collapses case, punctuation and spacing so title variants compare equal. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Surname of the first author, as the second half of the preprint/published
 * dedup key.
 *
 * Handles both "Given Surname" and "Surname, Given" orderings, which Valyu
 * returns interchangeably. Returns undefined when there are no authors — as for
 * clinical trials — and callers must treat that as "do not match on title".
 */
export function firstAuthorKey(authors?: string[]): string | undefined {
  const first = authors?.[0]?.trim();
  if (!first) return undefined;

  const surname = first.includes(',')
    ? first.split(',')[0]
    : first.split(/\s+/).at(-1);

  const key = normaliseTitle(surname ?? '');
  return key === '' ? undefined : key;
}
