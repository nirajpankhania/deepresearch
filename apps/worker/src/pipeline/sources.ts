import type { Source } from '@deepresearch/shared';
import type { SearchResult } from '../clients/valyu.js';

import {
  extractArxivId,
  extractNctId,
  extractPubmedId,
  normaliseDoi,
  normaliseUrl,
} from './identifiers.js';

/**
 * Maps a Valyu search result to a `Source`, preserving the structured metadata.
 *
 * The brief is explicit that keeping only the URL is not enough, and the fields
 * genuinely differ by source type: an arXiv preprint has authors and a DOI, a
 * clinical trial has neither and carries its payload as a JSON blob instead.
 * Everything optional stays optional rather than being coerced to a placeholder,
 * so the frontend can distinguish "no publication date" from "unknown".
 */

/** Content is truncated well before it reaches a prompt, but stored longer. */
const SNIPPET_CHARS = 4000;

/** Per-result cost by dataset, from Valyu's published cpm (dollars per 1000). */
const CPM_BY_DATASET: Record<string, number> = {
  'valyu/valyu-arxiv': 1.0,
  'valyu/valyu-pubmed': 1.0,
  'valyu/valyu-biorxiv': 1.0,
  'valyu/valyu-medrxiv': 1.0,
  'valyu/valyu-chemrxiv': 5.0,
  'valyu/valyu-clinical-trials': 5.0,
  'valyu/valyu-chembl': 3.0,
  'valyu/valyu-drug-labels': 3.0,
  'valyu/valyu-open-targets': 3.0,
  'valyu/valyu-pubchem': 3.0,
  'valyu/valyu-openfda-drug-events': 3.0,
  'valyu/valyu-who-health-data': 3.0,
  'valyu/valyu-nih-grants': 3.0,
  'valyu/valyu-patents': 8.0,
  'valyu/valyu-patents-epo': 8.0,
};

/** Conservative default for anything not in the table, including `web`. */
const DEFAULT_CPM = 8.0;

/**
 * Worst-case dollars for a search returning `maxResults` from these sources.
 * Deliberately pessimistic: it takes the most expensive source in the set, so
 * the budget gate errs towards refusing rather than overspending.
 */
export function estimateSearchCost(includedSources: string[], maxResults: number): number {
  const cpm = includedSources.length === 0
    ? DEFAULT_CPM
    : Math.max(...includedSources.map((s) => CPM_BY_DATASET[s] ?? DEFAULT_CPM));
  return (cpm / 1000) * maxResults;
}

/** Content arrives as a string for documents and as an object for structured rows. */
function toText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/** Valyu returns dates in several shapes; only a clean ISO date is useful. */
function toIsoDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  if (m?.[1]) return m[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/**
 * A stable citation id, preferring a real identifier so the same work keeps the
 * same id across runs. Falls back to the normalised URL.
 */
function stableId(s: {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  pmcId?: string;
  nctId?: string;
  url: string;
}): string {
  if (s.doi) return `doi:${s.doi}`;
  if (s.arxivId) return `arxiv:${s.arxivId}`;
  if (s.pmid) return `pmid:${s.pmid}`;
  if (s.pmcId) return `pmc:${s.pmcId}`;
  if (s.nctId) return `nct:${s.nctId}`;
  return `url:${normaliseUrl(s.url)}`;
}

export function toSource(result: SearchResult, fromQueryIndex: number): Source {
  const url = result.url ?? '';
  const doi = normaliseDoi(result.doi);
  const arxivId = extractArxivId(url, result.doi);
  const pubmed = extractPubmedId(url);
  const nctId = extractNctId(url, result.id);

  const ids = {
    url,
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pubmed?.kind === 'pmid' ? { pmid: pubmed.value } : {}),
    ...(pubmed?.kind === 'pmc' ? { pmcId: pubmed.value } : {}),
    ...(nctId ? { nctId } : {}),
  };

  const publicationDate = toIsoDate(result.publication_date ?? result.date);
  const snippet = toText(result.content).slice(0, SNIPPET_CHARS);

  return {
    id: stableId(ids),
    title: result.title ?? '(untitled)',
    ...ids,
    fromQueryIndex,
    ...(result.source ? { dataset: result.source } : {}),
    ...(result.source_type ? { sourceType: result.source_type } : {}),
    ...(publicationDate ? { publicationDate } : {}),
    ...(result.authors?.length ? { authors: result.authors } : {}),
    ...(typeof result.relevance_score === 'number'
      ? { relevanceScore: result.relevance_score }
      : {}),
    ...(snippet ? { snippet } : {}),
  };
}
