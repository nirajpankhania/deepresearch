import type { Task } from '@deepresearch/shared';

/**
 * Domain feature 2 — what the system actually searched, shown *while* it
 * searches.
 *
 * The queries are published to the task document as soon as the planner returns
 * and updated as each search lands, so this fills in live: the sub-questions
 * appear, then tick off one by one with their result counts. Previously it sat
 * empty for the whole run and appeared fully-formed at the end, which told the
 * user nothing at the moment they most wanted to know what was happening.
 *
 * A failed sub-query is shown as failed rather than hidden, because a report
 * built from three of four facets is a different object from one built from all
 * four, and only the reader can judge whether the gap matters.
 */

function datasetLabel(source: string): string {
  return source.replace(/^valyu\/valyu-/, '').replace(/^valyu\//, '');
}

export function SearchPanel({ task, defaultOpen = false }: { task: Task; defaultOpen?: boolean }) {
  const { queries, sources } = task;
  if (queries.length === 0) return null;

  const settled = queries.filter((q) => q.done).length;
  const running = task.status === 'running' || task.status === 'queued';
  const totalResults = queries.reduce((n, q) => n + q.resultCount, 0);
  const merged = totalResults - sources.length;

  return (
    <details className="panel" open={defaultOpen || running}>
      <summary>
        What was searched
        <span className="panel-count">
          {running && settled < queries.length ? `${settled}/${queries.length}` : queries.length}
        </span>
      </summary>

      <div className="panel-body">
        {queries.map((q, i) => {
          const pending = !q.done && running;
          return (
            <div
              className={`query${q.error ? ' query-failed' : ''}${pending ? ' query-live' : ''}`}
              key={`${q.query}-${i}`}
            >
              <p className="query-text">{q.query}</p>

              <div className="source-meta" style={{ marginTop: 0 }}>
                {q.includedSources.map((s) => (
                  <span className="tag" key={s}>
                    {datasetLabel(s)}
                  </span>
                ))}

                {pending ? (
                  <span className="query-status">
                    <span className="spinner" aria-hidden="true" /> searching…
                  </span>
                ) : (
                  <span className={`query-status${q.error ? '' : ' query-done'}`}>
                    {q.error ? '—' : '✓'} {q.resultCount} result{q.resultCount === 1 ? '' : 's'}
                    {q.costUsd !== undefined ? ` · $${q.costUsd.toFixed(4)}` : ''}
                  </span>
                )}
              </div>

              {q.rationale ? <p className="query-why">{q.rationale}</p> : null}
              {q.error ? <p className="query-error">{q.error}</p> : null}
            </div>
          );
        })}

        {!running ? (
          <dl style={{ margin: '1.1rem 0 0' }}>
            <div className="ledger">
              <dt>Results retrieved</dt>
              <dd>{totalResults}</dd>
            </div>
            {merged > 0 ? (
              <div className="ledger">
                <dt title="Same work found more than once, merged on identifier or title and author">
                  Merged as duplicates
                </dt>
                <dd>{merged}</dd>
              </div>
            ) : null}
            <div className="ledger">
              <dt>Sources used</dt>
              <dd>{sources.length}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </details>
  );
}
