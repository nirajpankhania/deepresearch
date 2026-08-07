import type { DateRange, Source } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

import { TaskGoneError } from '@deepresearch/shared/firestore';

import type { GeminiClient } from '../clients/gemini.js';

/**
 * Stage 5 — write the report.
 *
 * One Pro-tier call. This is the only stage where model capability is directly
 * visible in the deliverable, and the only one that has to hold twenty sources
 * in mind at once while keeping citations attached to the right claims.
 *
 * The model writes the body with `[n]` markers. It does **not** write the source
 * list: that is rendered here from the retrieved metadata, so every citation
 * resolves to a real URL. Asking a model to reproduce twenty URLs invites exactly
 * the failure the whole design exists to prevent — a report that looks cited but
 * links to something that does not exist.
 */

/** Per-source content given to the model. Twenty of these is a manageable prompt. */
export const SOURCE_CONTENT_CHARS = 2000;

/** Matches `[1]`, and each number inside `[1, 2]` or `[1,2,3]`. */
const CITATION_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

function authorLine(authors?: string[]): string | undefined {
  if (!authors?.length) return undefined;
  return authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ');
}

function identifierLine(s: Source): string | undefined {
  if (s.doi) return `DOI ${s.doi}`;
  if (s.arxivId) return `arXiv:${s.arxivId}`;
  if (s.pmid) return `PMID ${s.pmid}`;
  if (s.pmcId) return s.pmcId;
  if (s.nctId) return s.nctId;
  return undefined;
}

/**
 * Numbered source blocks for the prompt.
 *
 * Metadata is included because it changes how a claim should be weighted: a 2019
 * preprint and a 2025 randomised trial do not carry the same evidential weight,
 * and the model cannot know which is which from the text alone.
 */
export function formatSourcesForPrompt(sources: Source[], contentChars = SOURCE_CONTENT_CHARS): string {
  return sources
    .map((s, i) => {
      const meta = [
        authorLine(s.authors),
        s.publicationDate,
        s.dataset,
        identifierLine(s),
      ]
        .filter(Boolean)
        .join(' · ');

      const content = (s.snippet ?? '').slice(0, contentChars).trim();

      return [
        `[${i + 1}] ${s.title}`,
        meta ? `    ${meta}` : undefined,
        content ? `    ${content}` : '    (no extracted content)',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

export function buildSynthesisPrompt(
  question: string,
  sources: Source[],
  dateRange?: DateRange,
): string {
  const dateNote =
    dateRange?.start || dateRange?.end
      ? `\nThe search was restricted to ${dateRange.start ?? 'any date'} → ${dateRange.end ?? 'today'}, so the corpus may omit relevant older or newer work. Say so if it matters to the answer.`
      : '';

  return `Write a research report answering the question below, using only the numbered sources provided.

QUESTION: ${question}${dateNote}

GROUNDING — this is the rule that matters most.
Every substantive claim must be supported by a source, cited inline as [n].
If the sources do not answer part of the question, say so explicitly. Do not
fill the gap from your own knowledge: an unsupported claim that reads well is
worse than an acknowledged gap, because the reader cannot tell which is which.
Where sources disagree, report the disagreement rather than picking a side.

CITATIONS.
Cite as [1] or [1, 3] immediately after the claim they support. Use only the
numbers given below — never invent a source number. Do not write a sources or
references section; it is generated separately.

WEIGHTING.
Prefer the strongest evidence available. A randomised trial outweighs an
observational study; a peer-reviewed paper outweighs a preprint; a registered
trial record describes a plan, not a result. The metadata line for each source
tells you which is which. Note the strength of the evidence where it bears on
how confident the answer can be.

STRUCTURE.
Start with a direct answer to the question in two or three sentences, before any
heading. Then cover the substance in sections. Finish with a "Limitations"
section covering what the corpus could not establish.

Use level-two headings exactly — "## Section name". Do not use "###" or deeper:
the generated sources section is level two, and deeper headings render as if
nested beneath it. Do not write a title heading.

Aim for 500-900 words. Markdown.

SOURCES:
${formatSourcesForPrompt(sources)}`;
}

/** Every distinct source number cited in the report body. */
export function extractCitedIndices(markdown: string): Set<number> {
  const cited = new Set<number>();
  for (const match of markdown.matchAll(CITATION_PATTERN)) {
    for (const part of (match[1] ?? '').split(',')) {
      const n = Number.parseInt(part.trim(), 10);
      if (Number.isInteger(n)) cited.add(n);
    }
  }
  return cited;
}

/**
 * Removes citations pointing outside the corpus.
 *
 * A model that invents `[27]` against twenty sources produces a report that looks
 * cited and is not. Dropping the marker leaves the sentence visibly unsupported,
 * which is the honest outcome; the grounding stage then judges it as such.
 */
export function stripInvalidCitations(
  markdown: string,
  sourceCount: number,
): { report: string; removed: number[] } {
  const removed: number[] = [];

  const report = markdown.replace(CITATION_PATTERN, (whole, group: string) => {
    const numbers = group.split(',').map((p) => Number.parseInt(p.trim(), 10));
    const valid = numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount);
    for (const n of numbers) if (!valid.includes(n)) removed.push(n);

    if (valid.length === 0) return '';
    if (valid.length === numbers.length) return whole;
    return `[${valid.join(', ')}]`;
  });

  return { report, removed };
}

/** The sources section, rendered from metadata so every link resolves. */
export function renderSourceList(sources: Source[]): string {
  const lines = ['## Sources', ''];

  sources.forEach((s, i) => {
    const meta = [authorLine(s.authors), s.publicationDate, s.dataset, identifierLine(s)]
      .filter(Boolean)
      .join(' · ');

    lines.push(`${i + 1}. [${s.title}](${s.url})`);
    if (meta) lines.push(`   ${meta}  `);

    // Surfacing the merged copy matters to a reader checking a citation: the
    // alternate is often the open-access version of a paywalled record.
    for (const alt of s.mergedAlternates ?? []) {
      if (alt.url !== s.url) lines.push(`   Also available: <${alt.url}>  `);
    }
  });

  return lines.join('\n');
}

export interface SynthesisOptions {
  gemini: GeminiClient;
  question: string;
  sources: Source[];
  dateRange?: DateRange;
  log: Logger;
  /**
   * Called with the accumulated text as it streams, already throttled.
   * Optional: without it synthesis simply produces the report in one go.
   */
  onDraft?: (partial: string) => Promise<void>;
}

/**
 * How often partial text is published while streaming.
 *
 * A write per token would be absurd, but 750ms was too coarse: it arrived in
 * visible ~700-character lumps. Now that a draft frame carries only the appended
 * characters rather than the whole task, publishing is cheap enough to do four
 * times a second. The client smooths the remainder into a per-character reveal.
 */
const DRAFT_INTERVAL_MS = 250;

export interface SynthesisResult {
  report: string;
  citedSourceCount: number;
  uncitedSourceCount: number;
}

export async function synthesiseReport(opts: SynthesisOptions): Promise<SynthesisResult> {
  const { gemini, question, sources, dateRange, log } = opts;

  if (sources.length === 0) throw new Error('cannot synthesise a report with no sources');

  const prompt = buildSynthesisPrompt(question, sources, dateRange);
  let lastPublished = 0;

  const body = await gemini.generateStream({
    tier: 'pro',
    stage: 'synthesising',
    prompt,
    // Roughly 900 words of prose, plus headroom for reasoning tokens, which
    // count against this budget on the Gemini 3 line.
    maxOutputTokens: 16_384,
    thinkingBudget: 4096,
    temperature: 0.3,
  }, async (accumulated) => {
    if (!opts.onDraft) return;
    const now = Date.now();
    if (now - lastPublished < DRAFT_INTERVAL_MS) return;
    lastPublished = now;
    // A failed publish must not abort generation: the draft is a convenience,
    // the report is the deliverable. A *deleted* task is different — stop
    // immediately rather than finish an expensive call nobody will read.
    await opts.onDraft(accumulated).catch((err: unknown) => {
      if (err instanceof TaskGoneError) throw err;
    });
  });

  const { report: cleaned, removed } = stripInvalidCitations(body.trim(), sources.length);
  if (removed.length > 0) {
    log.warn('removed citations pointing outside the corpus', {
      removed,
      sourceCount: sources.length,
    });
  }

  const cited = extractCitedIndices(cleaned);

  log.info('synthesis complete', {
    reportChars: cleaned.length,
    citedSources: cited.size,
    totalSources: sources.length,
  });

  return {
    report: `${cleaned}\n\n${renderSourceList(sources)}\n`,
    citedSourceCount: cited.size,
    uncitedSourceCount: sources.length - cited.size,
  };
}
