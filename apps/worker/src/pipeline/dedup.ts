import type { MergedAlternate, Source } from '@deepresearch/shared';

import { firstAuthorKey, normaliseTitle, normaliseUrl } from './identifiers.js';

/**
 * Two-pass deduplication.
 *
 * Pass one matches on stable identifiers, in precedence order. Pass two matches
 * on normalised title plus first-author surname.
 *
 * The second pass is the one that earns its place. A preprint and its published
 * version have *different* DOIs — the preprint's is issued by arXiv, the
 * published one by the journal — so identifier matching alone reports them as
 * two separate sources, which is precisely the case the brief calls out. Title
 * and author is what catches them.
 *
 * The lower-scoring copy is retained as a `mergedAlternate` rather than
 * discarded: which version a search surfaced is itself informative, and a reader
 * checking a citation may want the open-access preprint rather than the paywalled
 * version of record.
 */

type MergeKind = MergedAlternate['mergedBy'];

/**
 * Cap on reassembled content per source. Valyu splits a long document into
 * several results, so a heavily-chunked article can otherwise grow without
 * bound once the pieces are rejoined.
 */
const MAX_MERGED_SNIPPET_CHARS = 12_000;

interface Cluster {
  primary: Source;
  alternates: MergedAlternate[];
  /**
   * Content from results that are the *same document*, in retrieval order.
   *
   * Valyu returns a document as multiple chunked results — ids look like
   * `uuid:PMC12592101:3`. Deduplicating them is correct, but keeping only one
   * chunk's text would discard most of the article and leave synthesis reasoning
   * from a fragment. These are rejoined; renditions merged by title-and-author
   * are not, since those are different documents.
   */
  snippets: string[];
}

function toAlternate(s: Source, mergedBy: MergeKind): MergedAlternate {
  const alt: MergedAlternate = { url: s.url, mergedBy };
  if (s.title) alt.title = s.title;
  if (s.dataset) alt.dataset = s.dataset;
  if (s.doi) alt.doi = s.doi;
  if (s.publicationDate) alt.publicationDate = s.publicationDate;
  return alt;
}

/** Identifier keys for a source, highest precedence first. */
function keysFor(s: Source): { key: string; kind: MergeKind }[] {
  const keys: { key: string; kind: MergeKind }[] = [];
  if (s.doi) keys.push({ key: `doi:${s.doi}`, kind: 'doi' });
  if (s.arxivId) keys.push({ key: `arxiv:${s.arxivId}`, kind: 'arxivId' });
  if (s.pmid) keys.push({ key: `pmid:${s.pmid}`, kind: 'pmid' });
  if (s.pmcId) keys.push({ key: `pmc:${s.pmcId}`, kind: 'pmcId' });
  if (s.nctId) keys.push({ key: `nct:${s.nctId}`, kind: 'nctId' });
  // Always present, always last: the fallback the brief asks for.
  keys.push({ key: `url:${normaliseUrl(s.url)}`, kind: 'url' });
  return keys;
}

function score(s: Source): number {
  return s.relevanceScore ?? 0;
}

/** Folds `incoming` into `cluster`, keeping whichever copy scored higher. */
function mergeInto(cluster: Cluster, incoming: Source, mergedBy: MergeKind): void {
  const inherited = incoming.mergedAlternates ?? [];

  // Same document, chunked. Keep the text; it is the rest of the article.
  if (mergedBy !== 'title-author' && incoming.snippet) {
    cluster.snippets.push(incoming.snippet);
  }

  if (score(incoming) > score(cluster.primary)) {
    cluster.alternates.push(toAlternate(cluster.primary, mergedBy), ...inherited);
    cluster.primary = incoming;
  } else {
    cluster.alternates.push(toAlternate(incoming, mergedBy), ...inherited);
  }
}

/**
 * Merges two whole clusters matched on title and author — a preprint and its
 * published version.
 *
 * Cluster-level rather than source-level because the winner's *chunks* have to
 * travel with it. Merging only the primaries would leave the surviving record
 * carrying the losing document's text.
 *
 * The loser's chunk text is discarded rather than concatenated: these are two
 * renditions of the same work, and interleaving them would produce a source
 * whose quoted content matches neither version exactly.
 */
function mergeClusters(a: Cluster, b: Cluster): Cluster {
  const [winner, loser] = score(b.primary) > score(a.primary) ? [b, a] : [a, b];
  return {
    primary: winner.primary,
    snippets: winner.snippets,
    alternates: [
      ...winner.alternates,
      toAlternate(loser.primary, 'title-author'),
      ...loser.alternates,
    ],
  };
}

/** Rejoins chunk text, dropping exact repeats and bounding total length. */
function joinSnippets(snippets: string[]): string | undefined {
  const seen = new Set<string>();
  const parts: string[] = [];
  let length = 0;

  const SEPARATOR = '\n\n';

  for (const snippet of snippets) {
    const text = snippet.trim();
    if (text === '' || seen.has(text)) continue;
    seen.add(text);

    // The separator counts against the cap too, or the joined result overshoots
    // it by two characters per chunk.
    const cost = text.length + (parts.length > 0 ? SEPARATOR.length : 0);

    if (length + cost > MAX_MERGED_SNIPPET_CHARS) {
      const room = MAX_MERGED_SNIPPET_CHARS - length - (parts.length > 0 ? SEPARATOR.length : 0);
      if (room > 0) parts.push(text.slice(0, room));
      break;
    }

    parts.push(text);
    length += cost;
  }

  return parts.length === 0 ? undefined : parts.join('\n\n');
}

function finalise(cluster: Cluster): Source {
  const snippet = joinSnippets(cluster.snippets);

  const base: Source = { ...cluster.primary };
  if (snippet) base.snippet = snippet;
  else delete base.snippet;

  if (cluster.alternates.length === 0) {
    delete base.mergedAlternates;
    return base;
  }
  return { ...base, mergedAlternates: cluster.alternates };
}

export function dedupeSources(sources: Source[]): Source[] {
  // --- Pass one: stable identifiers, in precedence order --------------------
  const clusters: Cluster[] = [];
  const byKey = new Map<string, number>();

  for (const source of sources) {
    const keys = keysFor(source);

    // The first key that already exists decides both the cluster and the
    // reported merge reason, so a DOI match is reported as such even when the
    // URLs also happen to match.
    const hit = keys.find(({ key }) => byKey.has(key));

    if (hit) {
      const index = byKey.get(hit.key) as number;
      const cluster = clusters[index] as Cluster;
      mergeInto(cluster, source, hit.kind);
      // Register the incoming source's other keys against the same cluster, so
      // a third copy sharing only one of them still lands here.
      for (const { key } of keys) if (!byKey.has(key)) byKey.set(key, index);
      continue;
    }

    const index = clusters.length;
    clusters.push({
      primary: source,
      alternates: [],
      snippets: source.snippet ? [source.snippet] : [],
    });
    for (const { key } of keys) byKey.set(key, index);
  }

  // --- Pass two: normalised title plus first author -------------------------
  const merged: Cluster[] = [];
  const byTitleAuthor = new Map<string, number>();

  for (const cluster of clusters) {
    const author = firstAuthorKey(cluster.primary.authors);

    // No authors means no title matching. Clinical trials have no author list,
    // and distinct trials routinely share a title — merging those would be
    // worse than leaving a duplicate.
    if (!author) {
      merged.push(cluster);
      continue;
    }

    const key = `${normaliseTitle(cluster.primary.title)}|${author}`;
    const existing = byTitleAuthor.get(key);

    if (existing !== undefined) {
      merged[existing] = mergeClusters(merged[existing] as Cluster, cluster);
      continue;
    }

    byTitleAuthor.set(key, merged.length);
    merged.push(cluster);
  }

  return merged.map(finalise);
}
