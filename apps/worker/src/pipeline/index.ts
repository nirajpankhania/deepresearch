import type { CompletionResult } from '@deepresearch/shared/firestore';
import type { Logger } from '@deepresearch/shared/logger';
import type { PlannedQuery, Progress, Source, Task } from '@deepresearch/shared';

import { TaskGoneError } from '@deepresearch/shared/firestore';

import { FORCE_FAILURE_SENTINEL } from '../config.js';

/**
 * Publishing intermediate state is a convenience: a failed write should not lose
 * a report that is otherwise fine. A *deleted* task is the exception — that is
 * the user asking us to stop, and continuing would spend real money producing a
 * report with nowhere to go.
 */
function ignoreUnlessGone(err: unknown): never | undefined {
  if (err instanceof TaskGoneError) throw err;
  return undefined;
}
import type { GeminiClient } from '../clients/gemini.js';
import type { ValyuClient } from '../clients/valyu.js';
import { BudgetLedger } from './budget.js';
import { dedupeSources } from './dedup.js';
import { groundReport } from './ground.js';
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
  /** Publishes intermediate state so the interface can show work as it happens. */
  publish: {
    queries: (queries: PlannedQuery[]) => Promise<void>;
    sources: (sources: Source[]) => Promise<void>;
    draft: (partial: string) => Promise<void>;
  };
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
 * Stages 1-6: plan, retrieve under a spend cap, deduplicate, rerank against the
 * original question, synthesise a cited report, then check every cited claim
 * against the source it cites.
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

  // Published before retrieval starts, so the sub-queries are visible while they
  // are being searched rather than only in the finished report.
  await ctx.publish.queries(planned).catch(ignoreUnlessGone);

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
    onQueriesChanged: ctx.publish.queries,
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

  // Published before synthesis so citations in the streaming draft resolve to
  // real source cards immediately.
  await ctx.publish.sources(selected).catch(ignoreUnlessGone);

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
    onDraft: ctx.publish.draft,
    ...(task.dateRange ? { dateRange: task.dateRange } : {}),
  });

  // --- Stage 6: check each cited claim against the source it cites ----------
  // This progress write is also the deletion check before the last model call:
  // it throws TaskGoneError if the task was removed during synthesis, which is
  // the longest window in which that can happen.
  await onProgress({ step: 'grounding', message: 'Checking claims against sources', pct: 95 });
  const grounding = await groundReport({
    gemini,
    report: synthesis.report,
    sources: selected,
    log,
  });

  log.info('pipeline complete', {
    sources: selected.length,
    citedSources: synthesis.citedSourceCount,
    uncitedSources: synthesis.uncitedSourceCount,
    groundedClaims: grounding?.totalCount ?? 0,
    supportedClaims: grounding?.supportedCount ?? 0,
    modelCalls: gemini.callCount,
    costUsd: budget.record().totalUsd,
  });

  return {
    report: synthesis.report,
    queries,
    sources: selected,
    // Measured retrieval spend, plus estimated model spend kept separate so the
    // two are never presented as equally trustworthy.
    cost: { ...budget.record(), model: gemini.modelUsage },
    // Absent rather than empty when grounding could not run, so the interface
    // can distinguish "not checked" from "checked and found nothing".
    ...(grounding ? { grounding } : {}),
  };
}
