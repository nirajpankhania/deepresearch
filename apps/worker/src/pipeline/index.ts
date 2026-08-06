import type { CompletionResult } from '@deepresearch/shared/firestore';
import type { Logger } from '@deepresearch/shared/logger';
import type { Progress, Source, Task } from '@deepresearch/shared';

import { FORCE_FAILURE_SENTINEL } from '../config.js';
import type { GeminiClient } from '../clients/gemini.js';
import type { ValyuClient } from '../clients/valyu.js';
import { BudgetLedger } from './budget.js';
import { dedupeSources } from './dedup.js';
import { planQueries } from './plan.js';
import { rerankSources } from './rerank.js';
import { runRetrieval } from './retrieve.js';

export interface PipelineContext {
  task: Task;
  log: Logger;
  /** Report progress and extend the lease. */
  onProgress: (progress: Progress) => Promise<void>;
  /** When true, the force-failure sentinel in a question is honoured. */
  faultInjectionEnabled: boolean;
  valyu: ValyuClient;
  gemini: GeminiClient;
  limits: {
    maxTaskCostUsd: number;
    maxResultsPerQuery: number;
    relevanceThreshold: number;
    maxSources: number;
  };
}

/** Thrown by fault injection. Ordinary pipeline failures throw normal errors. */
export class InjectedFailure extends Error {
  constructor(attempt: number) {
    super(`Injected failure (attempt ${attempt})`);
    this.name = 'InjectedFailure';
  }
}

/**
 * The research pipeline.
 *
 * Stages 1-4 are implemented: plan, retrieve under a spend cap, deduplicate, and
 * rerank against the original question. Stage 5 (synthesis) and stage 6 (claim
 * grounding) follow in later phases; until then the report is an interim
 * listing of what retrieval selected, so the stage is verifiable on its own.
 */
export async function runPipeline(ctx: PipelineContext): Promise<CompletionResult> {
  const { task, log, onProgress, faultInjectionEnabled, valyu, gemini, limits } = ctx;

  if (faultInjectionEnabled && task.question.includes(FORCE_FAILURE_SENTINEL)) {
    log.warn('fault injection triggered', { attempt: task.attempt });
    throw new InjectedFailure(task.attempt);
  }

  const budget = new BudgetLedger(limits.maxTaskCostUsd);

  // --- Stage 1: plan --------------------------------------------------------
  await onProgress({ step: 'planning', message: 'Planning sub-queries', pct: 10 });
  const planned = await planQueries(gemini, task.question, task.dateRange);
  log.info('plan complete', {
    queryCount: planned.length,
    sources: planned.map((q) => q.includedSources),
  });

  // --- Stage 2 and 3: retrieve, under the budget gate -----------------------
  await onProgress({
    step: 'retrieving',
    message: `Searching ${planned.length} sub-queries`,
    pct: 30,
  });
  const { queries, sources: raw } = await runRetrieval({
    valyu,
    queries: planned,
    budget,
    maxResults: limits.maxResultsPerQuery,
    relevanceThreshold: limits.relevanceThreshold,
    log,
    ...(task.dateRange ? { dateRange: task.dateRange } : {}),
  });

  if (raw.length === 0) {
    // Every sub-query failed or was skipped. A report from no sources would be
    // parametric knowledge dressed up as research, which is the failure mode the
    // whole design exists to avoid.
    throw new Error('no sources were retrieved for this question');
  }

  // --- Stage 4: deduplicate, then rerank against the original question ------
  await onProgress({ step: 'deduplicating', message: 'Merging duplicate sources', pct: 55 });
  const deduped = dedupeSources(raw);
  const mergedCount = raw.length - deduped.length;
  log.info('dedup complete', { before: raw.length, after: deduped.length, merged: mergedCount });

  await onProgress({ step: 'reranking', message: 'Ranking sources by relevance', pct: 70 });
  const selected = await rerankSources({
    gemini,
    question: task.question,
    sources: deduped,
    limit: limits.maxSources,
    log,
  });

  await onProgress({ step: 'synthesising', message: 'Preparing report', pct: 90 });

  return {
    report: buildInterimReport(task.question, queries, selected, mergedCount),
    queries,
    sources: selected,
    cost: budget.record(),
  };
}

/**
 * Interim output for Phase 2, replaced by real synthesis in Phase 3.
 *
 * Written as proper Markdown with working citation links so the rendering path
 * and the frontend can be built against something representative.
 */
function buildInterimReport(
  question: string,
  queries: { query: string; includedSources: string[]; resultCount: number; error?: string }[],
  sources: Source[],
  mergedCount: number,
): string {
  const lines: string[] = [
    `# Retrieval results`,
    ``,
    `**Question:** ${question}`,
    ``,
    `> Synthesis is not yet implemented. This is the source corpus that retrieval`,
    `> selected — ${sources.length} sources after merging ${mergedCount} duplicate${mergedCount === 1 ? '' : 's'}.`,
    ``,
    `## Searches run`,
    ``,
  ];

  for (const q of queries) {
    lines.push(
      `- **${q.query}** — ${q.includedSources.join(', ')} · ${q.resultCount} result${q.resultCount === 1 ? '' : 's'}${q.error ? ` · _${q.error}_` : ''}`,
    );
  }

  lines.push('', '## Sources', '');

  sources.forEach((s, i) => {
    const meta = [
      s.publicationDate,
      s.authors?.slice(0, 3).join(', '),
      s.dataset,
      s.rerankScore !== undefined ? `relevance ${s.rerankScore.toFixed(2)}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ');

    lines.push(`${i + 1}. [${s.title}](${s.url})`);
    if (meta) lines.push(`   ${meta}`);
    if (s.mergedAlternates?.length) {
      lines.push(`   _also found as: ${s.mergedAlternates.map((a) => a.url).join(', ')}_`);
    }
  });

  return lines.join('\n');
}
