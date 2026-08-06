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
import { synthesiseReport } from './synthesise.js';

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
 * Stages 1-5: plan, retrieve under a spend cap, deduplicate, rerank against the
 * original question, and synthesise a cited report. Stage 6 (claim grounding)
 * follows in the next phase.
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

  // --- Stage 5: synthesise --------------------------------------------------
  await onProgress({
    step: 'synthesising',
    message: `Writing report from ${selected.length} sources`,
    pct: 85,
  });
  const synthesis = await synthesiseReport({
    gemini,
    question: task.question,
    sources: selected,
    log,
    ...(task.dateRange ? { dateRange: task.dateRange } : {}),
  });

  log.info('pipeline complete', {
    sources: selected.length,
    citedSources: synthesis.citedSourceCount,
    uncitedSources: synthesis.uncitedSourceCount,
    modelCalls: gemini.callCount,
    costUsd: budget.record().totalUsd,
  });

  return {
    report: synthesis.report,
    queries,
    sources: selected,
    cost: budget.record(),
  };
}
