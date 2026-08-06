import type { Source } from '@deepresearch/shared';

/**
 * Domain feature 1 — source cards that show what a researcher needs to judge a
 * source before opening it.
 *
 * A title and a link is not enough for this audience. Whether a claim is worth
 * believing depends on what kind of document it is, when it was published, and
 * whether it is a preprint or a version of record — so all of that is on the
 * card. This is the payoff for preserving Valyu's structured metadata instead of
 * flattening every result down to a URL.
 */

function datasetLabel(dataset?: string): string {
  if (!dataset) return 'source';
  return dataset.replace(/^valyu\/valyu-/, '').replace(/^valyu\//, '');
}

/** The strongest identifier a source carries, with a resolver link where one exists. */
function identifier(s: Source): { label: string; href?: string } | null {
  if (s.doi) return { label: `DOI ${s.doi}`, href: `https://doi.org/${s.doi}` };
  if (s.arxivId) return { label: `arXiv:${s.arxivId}`, href: `https://arxiv.org/abs/${s.arxivId}` };
  if (s.pmid) return { label: `PMID ${s.pmid}`, href: `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}` };
  if (s.pmcId) return { label: s.pmcId, href: `https://www.ncbi.nlm.nih.gov/pmc/articles/${s.pmcId}` };
  if (s.nctId) return { label: s.nctId, href: `https://clinicaltrials.gov/study/${s.nctId}` };
  return null;
}

function authorLine(authors?: string[]): string | null {
  if (!authors?.length) return null;
  return authors.length > 3 ? `${authors.slice(0, 2).join(', ')} +${authors.length - 2}` : authors.join(', ');
}

export function SourceCard({ source, index }: { source: Source; index: number }) {
  const id = identifier(source);
  const authors = authorLine(source.authors);
  const score = source.rerankScore ?? source.relevanceScore;

  return (
    <article className="source" id={`source-${index}`}>
      <div className="source-head">
        <span className="source-n">{index}</span>
        <a className="source-title" href={source.url} target="_blank" rel="noreferrer noopener">
          {source.title}
        </a>
      </div>

      <div className="source-meta">
        <span className="tag">{datasetLabel(source.dataset)}</span>
        {source.publicationDate ? <span>{source.publicationDate}</span> : null}
        {authors ? <span>{authors}</span> : null}
        {id ? (
          id.href ? (
            <a className="tag tag-id" href={id.href} target="_blank" rel="noreferrer noopener">
              {id.label}
            </a>
          ) : (
            <span className="tag tag-id">{id.label}</span>
          )
        ) : null}

        {score !== undefined ? (
          <span
            className="score"
            title={
              source.rerankScore !== undefined
                ? 'Relevance to your question, scored after retrieval'
                : 'Relevance score from the search that found this'
            }
          >
            <span className="score-track">
              <span className="score-fill" style={{ width: `${Math.round(score * 100)}%` }} />
            </span>
            {score.toFixed(2)}
          </span>
        ) : null}
      </div>

      {/*
        A merged alternate is usually the preprint of a published paper, or the
        reverse. Worth surfacing rather than silently discarding: the reader may
        want the open-access copy, and knowing both exist is itself information.
      */}
      {source.mergedAlternates?.length ? (
        <div className="alternate">
          Also found as{' '}
          {source.mergedAlternates
            .filter((a) => a.url !== source.url)
            .map((a, i) => (
              <span key={a.url}>
                {i > 0 ? ', ' : ''}
                <a href={a.url} target="_blank" rel="noreferrer noopener">
                  {a.dataset ? datasetLabel(a.dataset) : 'another copy'}
                </a>
              </span>
            ))}
          {source.mergedAlternates.every((a) => a.url === source.url) ? (
            <span>
              {source.mergedAlternates.length} further extract
              {source.mergedAlternates.length === 1 ? '' : 's'} of the same document
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
