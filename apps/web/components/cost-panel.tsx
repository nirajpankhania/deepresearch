import type { CostRecord } from '@deepresearch/shared';

/**
 * Where the money went.
 *
 * The distinction the panel is built around: retrieval spend is **measured**,
 * taken from Valyu's own response and backed by transaction ids that can be
 * checked against their billing. Model spend is **estimated** from token counts
 * against list prices. Presenting one number would imply both are equally
 * trustworthy, so they are shown separately and labelled.
 *
 * Reasoning tokens get their own column because they are billed as output,
 * never appear in the response, and are routinely the largest single line —
 * which makes them the most surprising thing on a model bill.
 */

const STAGE_LABEL: Record<string, string> = {
  planning: 'Plan sub-queries',
  reranking: 'Rerank sources',
  synthesising: 'Write report',
  grounding: 'Check claims',
};

function usd(n: number): string {
  if (n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function CostPanel({
  cost,
  queries,
}: {
  cost: CostRecord;
  queries: { query: string; costUsd?: number; resultCount: number }[];
}) {
  const modelUsd = cost.model?.estimatedUsd ?? 0;
  const total = cost.totalUsd + modelUsd;

  return (
    <details className="panel">
      <summary>
        Cost
        <span className="panel-count">{usd(total)}</span>
      </summary>

      <div className="panel-body">
        <h4 className="sidebar-title" style={{ marginTop: 0 }}>
          Retrieval · <span className="measured">measured</span>
        </h4>
        <table className="cost-table">
          <thead>
            <tr>
              <th>Sub-query</th>
              <th>Results</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((q, i) => (
              <tr key={`${q.query}-${i}`}>
                <td title={q.query}>
                  {q.query.length > 38 ? `${q.query.slice(0, 38)}…` : q.query}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {q.resultCount}
                </td>
                <td>{q.costUsd === undefined ? '—' : usd(q.costUsd)}</td>
              </tr>
            ))}
            <tr className="cost-total">
              <td colSpan={2}>Retrieval total</td>
              <td>{usd(cost.totalUsd)}</td>
            </tr>
          </tbody>
        </table>

        {cost.model && cost.model.calls.length > 0 ? (
          <>
            <h4 className="sidebar-title">Model · estimated</h4>
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Reasoning</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {cost.model.calls.map((call, i) => (
                  <tr key={`${call.stage}-${i}`}>
                    <td title={call.model}>{STAGE_LABEL[call.stage] ?? call.stage}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {tokens(call.promptTokens)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {tokens(call.outputTokens)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {tokens(call.thoughtTokens)}
                    </td>
                    <td>{usd(call.estimatedUsd)}</td>
                  </tr>
                ))}
                <tr className="cost-total">
                  <td colSpan={4}>Model total</td>
                  <td>{usd(modelUsd)}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}

        <table className="cost-table" style={{ marginTop: '1rem' }}>
          <tbody>
            <tr className="cost-total">
              <td>Task total</td>
              <td>{usd(total)}</td>
            </tr>
          </tbody>
        </table>

        <p className="cost-note">
          Retrieval cost is measured from the search responses and backed by{' '}
          {cost.txIds.length} transaction {cost.txIds.length === 1 ? 'id' : 'ids'}. Model cost is
          estimated from reported token counts against list prices. Reasoning tokens bill at the
          output rate but never appear in the response, which is why they are shown separately.
          {cost.cappedAt !== undefined
            ? ' Retrieval stopped early: the per-task budget cap was reached.'
            : ''}
        </p>
      </div>
    </details>
  );
}
