'use client';

import { useState } from 'react';
import type { ClaimVerdict, GroundingReport, Source } from '@deepresearch/shared';

/**
 * Surfaces the claim-grounding verdicts.
 *
 * The verdicts are shown, never acted on. Rewriting weak claims would mean a
 * second synthesis pass, doubling the failure surface and risking new ungrounded
 * text — so the interface tells the reader which sentences are weak and lets
 * them judge, which is what this audience wants anyway.
 *
 * Weak claims are listed first and expanded by default; supported ones are
 * collapsed. A reader checking a report cares about the three sentences that did
 * not verify, not the twenty that did.
 */

const VERDICT_LABEL: Record<ClaimVerdict, string> = {
  supported: 'Supported',
  partial: 'Partly supported',
  unsupported: 'Not supported',
};

const VERDICT_CLASS: Record<ClaimVerdict, string> = {
  supported: 'status-completed',
  partial: 'status-running',
  unsupported: 'status-failed',
};

function titleFor(sources: Source[], id: string): string {
  return sources.find((s) => s.id === id)?.title ?? 'Unknown source';
}

function indexFor(sources: Source[], id: string): number {
  return sources.findIndex((s) => s.id === id) + 1;
}

function Claim({ claim, sources }: { claim: GroundingReport['claims'][number]; sources: Source[] }) {
  return (
    <li className={`claim claim-${claim.verdict}`}>
      <div className="claim-head">
        <span className={`status ${VERDICT_CLASS[claim.verdict]}`}>
          {VERDICT_LABEL[claim.verdict]}
        </span>
      </div>
      <p className="claim-text">{claim.sentence}</p>
      {claim.reason ? <p className="claim-reason">{claim.reason}</p> : null}
      <p className="claim-sources">
        Checked against{' '}
        {claim.citedSourceIds.map((id, i) => {
          const n = indexFor(sources, id);
          return (
            <span key={id}>
              {i > 0 ? ', ' : ''}
              <a href={`#source-${n}`}>
                [{n}] {titleFor(sources, id).slice(0, 44)}
                {titleFor(sources, id).length > 44 ? '…' : ''}
              </a>
            </span>
          );
        })}
      </p>
    </li>
  );
}

export function Grounding({
  grounding,
  sources,
}: {
  grounding: GroundingReport;
  sources: Source[];
}) {
  const [showAll, setShowAll] = useState(false);

  const partial = grounding.claims.filter((c) => c.verdict === 'partial');
  const unsupported = grounding.claims.filter((c) => c.verdict === 'unsupported');
  const supported = grounding.claims.filter((c) => c.verdict === 'supported');
  const weak = [...unsupported, ...partial];

  const pct = (n: number): string =>
    grounding.totalCount === 0 ? '0%' : `${(n / grounding.totalCount) * 100}%`;

  return (
    <section className="card" aria-labelledby="grounding-title" style={{ marginTop: '2.5rem' }}>
      <h2 className="card-title" id="grounding-title">
        Claim check
      </h2>

      <p style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>
        <strong>
          {grounding.supportedCount} of {grounding.totalCount}
        </strong>{' '}
        cited claims are fully supported by the source they cite.
      </p>

      <div className="verdict-bar" role="img" aria-label={`${supported.length} supported, ${partial.length} partly supported, ${unsupported.length} not supported`}>
        <span className="v-supported" style={{ width: pct(supported.length) }} />
        <span className="v-partial" style={{ width: pct(partial.length) }} />
        <span className="v-unsupported" style={{ width: pct(unsupported.length) }} />
      </div>

      <div className="verdict-key">
        <span><i className="v-supported" /> {supported.length} supported</span>
        <span><i className="v-partial" /> {partial.length} partly</span>
        <span><i className="v-unsupported" /> {unsupported.length} not supported</span>
      </div>

      <p className="hint" style={{ marginTop: '0.8rem' }}>
        Each cited sentence was re-read against the text of the source it cites. Claims are shown,
        not corrected — a rewrite would risk introducing new unsupported text.
      </p>

      {weak.length > 0 ? (
        <>
          <h3 className="card-title" style={{ marginTop: '1.4rem' }}>
            Claims worth checking · {weak.length}
          </h3>
          <ul className="claims">
            {weak.map((claim, i) => (
              <Claim key={`${claim.sentence}-${i}`} claim={claim} sources={sources} />
            ))}
          </ul>
        </>
      ) : (
        <p style={{ fontSize: '0.9rem', margin: '1rem 0 0' }}>
          Every cited claim was fully supported by its source.
        </p>
      )}

      {supported.length > 0 ? (
        <>
          <button
            type="button"
            className="ghost"
            style={{ marginTop: '1rem' }}
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
          >
            {showAll ? 'Hide' : 'Show'} {supported.length} supported claim
            {supported.length === 1 ? '' : 's'}
          </button>

          {showAll ? (
            <ul className="claims" style={{ marginTop: '0.8rem' }}>
              {supported.map((claim, i) => (
                <Claim key={`${claim.sentence}-${i}`} claim={claim} sources={sources} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
