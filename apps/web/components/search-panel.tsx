import type { Task } from '@deepresearch/shared';

/**
 * Domain feature 2 — what the system actually searched.
 *
 * The most common failure of a research tool is not a wrong answer, it is an
 * answer whose provenance you cannot check. Showing the generated sub-queries,
 * which corpora each targeted, how many results each returned, and what the
 * whole thing cost turns "trust me" into something a reader can audit — and
 * makes a thin report legible as thin retrieval rather than a thin literature.
 *
 * A failed sub-query is shown as failed rather than hidden, because a report
 * built from three of four facets is a different object from one built from all
 * four, and only the reader can judge whether the gap matters.
 */

function datasetLabel(source: string): string {
  return source.replace(/^valyu\/valyu-/, '').replace(/^valyu\//, '');
}

export function SearchPanel({ task }: { task: Task }) {
  const { queries, cost, sources } = task;
  if (queries.length === 0) return null;

  const totalResults = queries.reduce((n, q) => n + q.resultCount, 0);
  const merged = totalResults - sources.length;

  return (
    <section className="card" aria-labelledby="searched-title">
      <h2 className="card-title" id="searched-title">
        What was searched
      </h2>

      {queries.map((q, i) => (
        <div className={`query${q.error ? ' query-failed' : ''}`} key={`${q.query}-${i}`}>
          <p className="query-text">{q.query}</p>

          <div className="source-meta" style={{ marginTop: 0 }}>
            {q.includedSources.map((s) => (
              <span className="tag" key={s}>
                {datasetLabel(s)}
              </span>
            ))}
            <span>
              {q.resultCount} result{q.resultCount === 1 ? '' : 's'}
            </span>
          </div>

          {q.rationale ? <p className="query-why">{q.rationale}</p> : null}
          {q.error ? <p className="query-error">{q.error}</p> : null}
        </div>
      ))}

      <dl style={{ margin: '1.1rem 0 0' }}>
        <div className="ledger">
          <dt>Results retrieved</dt>
          <dd>{totalResults}</dd>
        </div>
        {merged > 0 ? (
          <div className="ledger">
            <dt>Merged as duplicates</dt>
            <dd>{merged}</dd>
          </div>
        ) : null}
        <div className="ledger">
          <dt>Sources used</dt>
          <dd>{sources.length}</dd>
        </div>
        <div className="ledger">
          <dt title="Measured from the search responses, not estimated">Retrieval cost</dt>
          <dd>${cost.totalUsd.toFixed(4)}</dd>
        </div>
        {cost.cappedAt !== undefined ? (
          <div className="ledger">
            <dt>Budget cap</dt>
            <dd title="Further searches were skipped to stay within the per-task limit">reached</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
