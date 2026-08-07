import type { DateRange, PlannedQuery, Source } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

import { TaskGoneError } from '@deepresearch/shared/firestore';

import type { ValyuClient } from '../clients/valyu.js';
import type { BudgetLedger } from './budget.js';
import { estimateSearchCost, toSource } from './sources.js';

/**
 * Stage 2 — run the planned sub-queries, under a spend cap.
 *
 * Searches run concurrently and failures are isolated: one sub-query returning a
 * 502 costs that facet, not the task. A research report built from four of five
 * facets is still useful; one that fails outright is not.
 */

export interface RetrievalOptions {
  valyu: ValyuClient;
  queries: PlannedQuery[];
  budget: BudgetLedger;
  maxResults: number;
  relevanceThreshold: number;
  dateRange?: DateRange;
  log: Logger;
  /**
   * Called whenever a sub-query's outcome changes, so the interface can tick
   * searches off as they land rather than showing nothing until all finish.
   */
  onQueriesChanged?: (queries: PlannedQuery[]) => Promise<void>;
}

export interface RetrievalOutcome {
  /** The planned queries, annotated with result counts and any failure. */
  queries: PlannedQuery[];
  /** Mapped sources, before deduplication. */
  sources: Source[];
}

export async function runRetrieval(opts: RetrievalOptions): Promise<RetrievalOutcome> {
  const { valyu, budget, maxResults, relevanceThreshold, dateRange, log } = opts;

  // Cheapest first. If the cap bites, it should cost the expensive facet rather
  // than starving several cheap ones that would together have been affordable.
  const ordered = opts.queries
    .map((query, index) => ({
      query,
      index,
      estimate: estimateSearchCost(query.includedSources, maxResults),
    }))
    .sort((a, b) => a.estimate - b.estimate);

  const queries: PlannedQuery[] = opts.queries.map((q) => ({ ...q }));

  const dispatched = ordered.flatMap(({ query, index, estimate }) => {
    // The gate, checked BEFORE the call goes out. Reserving means concurrent
    // searches cannot each observe a spend of zero and all be permitted.
    if (!budget.reserve(estimate)) {
      log.warn('search skipped, budget cap reached', {
        query: query.query,
        estimateUsd: estimate,
        remainingUsd: budget.remaining(),
      });
      const target = queries[index];
      if (target) {
        target.error = 'Skipped: per-task retrieval budget reached';
        target.done = true;
      }
      return [];
    }
    return [{ query, index, estimate }];
  });

  const settled = await Promise.allSettled(
    dispatched.map(async ({ query, index, estimate }) => {
      try {
        const outcome = await valyu.search({
          query: query.query,
          includedSources: query.includedSources,
          maxResults,
          relevanceThreshold,
          ...(dateRange?.start ? { startDate: dateRange.start } : {}),
          ...(dateRange?.end ? { endDate: dateRange.end } : {}),
        });

        budget.settle(estimate, outcome.costUsd, outcome.txId);

        // Publish this facet's outcome immediately rather than waiting for the
        // slowest search: the point of showing queries live is lost if they all
        // appear at once at the end.
        const target = queries[index];
        if (target) {
          target.resultCount = outcome.results.length;
          target.costUsd = outcome.costUsd;
          target.done = true;
        }
        await opts.onQueriesChanged?.(queries).catch((e: unknown) => {
          if (e instanceof TaskGoneError) throw e;
        });

        return { index, results: outcome.results };
      } catch (err: unknown) {
        // Release the reservation so a failed call does not permanently consume
        // headroom that other facets could have used.
        budget.settle(estimate, 0);
        const target = queries[index];
        if (target) {
          target.error = 'This search failed and its results are missing from the report';
          target.done = true;
        }
        await opts.onQueriesChanged?.(queries).catch((e: unknown) => {
          if (e instanceof TaskGoneError) throw e;
        });
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { index });
      }
    }),
  );

  const sources: Source[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const { index, results } = result.value;
      for (const r of results) sources.push(toSource(r, index));
      continue;
    }

    // Already recorded on the query above, so the interface can show which facet
    // was lost rather than silently presenting a thinner report as if complete.
    const err = result.reason as Error & { index?: number };
    log.error('search failed', { reason: err.message, queryIndex: err.index });
  }

  log.info('retrieval complete', {
    dispatched: dispatched.length,
    skipped: opts.queries.length - dispatched.length,
    rawSources: sources.length,
    costUsd: budget.record().totalUsd,
  });

  return { queries, sources };
}
