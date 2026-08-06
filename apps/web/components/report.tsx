'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '@deepresearch/shared';

import { SourceCard } from './source-card';

/**
 * Renders the report, with citations wired to the source cards below it.
 *
 * The Markdown the backend produces ends with its own `## Sources` list. That is
 * dropped here and replaced by the source cards, which carry the same links plus
 * the metadata a reader needs. The plain list stays in the stored Markdown so the
 * report remains complete and useful outside this interface.
 */

/** Matches `[1]` and `[1, 2]`, the citation forms synthesis emits. */
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Rewrites inline `[n]` markers into links to the matching source card.
 *
 * Done as a Markdown transform rather than by rendering raw HTML, so the
 * renderer's HTML escaping stays on. `[1, 3]` becomes two adjacent links, which
 * is the conventional way that reads.
 */
export function linkCitations(markdown: string, sourceCount: number): string {
  return markdown.replace(CITATION, (whole, group: string) => {
    const numbers = group
      .split(',')
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount);

    if (numbers.length === 0) return whole;
    return numbers.map((n) => `[\\[${n}\\]](#source-${n})`).join('');
  });
}

/** Splits the generated source list off the body. */
export function splitReport(markdown: string): string {
  const index = markdown.search(/^##\s+Sources\s*$/m);
  return index === -1 ? markdown : markdown.slice(0, index).trimEnd();
}

export function Report({ report, sources }: { report: string; sources: Source[] }) {
  const body = linkCitations(splitReport(report), sources.length);

  return (
    <>
      <div className="report">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...rest }) => {
              const isCitation = typeof href === 'string' && href.startsWith('#source-');
              return (
                <a
                  href={href}
                  className={isCitation ? 'cite' : undefined}
                  {...(isCitation ? {} : { target: '_blank', rel: 'noreferrer noopener' })}
                  {...rest}
                >
                  {children}
                </a>
              );
            },
            // Wide tables scroll inside their own container rather than forcing
            // the page to scroll sideways.
            table: ({ children, ...rest }) => (
              <div className="scroll-x">
                <table {...rest}>{children}</table>
              </div>
            ),
          }}
        >
          {body}
        </ReactMarkdown>
      </div>

      <section aria-labelledby="sources-title" style={{ marginTop: '2.5rem' }}>
        <h2 className="card-title" id="sources-title">
          Sources · {sources.length}
        </h2>
        <div className="sources">
          {sources.map((source, i) => (
            <SourceCard key={source.id} source={source} index={i + 1} />
          ))}
        </div>
      </section>
    </>
  );
}
