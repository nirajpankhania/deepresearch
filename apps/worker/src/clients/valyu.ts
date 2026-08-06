import { Valyu } from 'valyu-js';
import type { SearchResult } from 'valyu-js';
import type { Logger } from '@deepresearch/shared/logger';

import { callWithRetry } from './resilience.js';

/**
 * Valyu search.
 *
 * Only `search` is used. The SDK also exposes `deepresearch` and an answer
 * endpoint, both of which would generate the report for us — building that
 * orchestration is the assignment, so they are deliberately untouched.
 *
 * The API key is held here and never logged. Every log line carries the query
 * and the measured cost; nothing carries the credential.
 */

export interface ValyuSearchParams {
  query: string;
  includedSources: string[];
  maxResults: number;
  relevanceThreshold: number;
  startDate?: string;
  endDate?: string;
}

export interface ValyuSearchOutcome {
  results: SearchResult[];
  /** Measured, from the response. Never estimated. */
  costUsd: number;
  txId?: string;
}

const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

export class ValyuClient {
  private readonly valyu: Valyu;

  constructor(
    apiKey: string,
    private readonly log: Logger,
  ) {
    this.valyu = new Valyu(apiKey);
  }

  async search(params: ValyuSearchParams): Promise<ValyuSearchOutcome> {
    const started = Date.now();

    // `web` is a valid source for the REST API but the SDK rejects it in
    // `includedSources`, which it validates client-side against a URL / domain /
    // `provider/dataset` shape. It has to be expressed as a searchType instead.
    const datasets = params.includedSources.filter((s) => s !== 'web');
    const wantsWeb = params.includedSources.includes('web');

    const response = await callWithRetry(
      async () =>
        this.valyu.search(params.query, {
          maxNumResults: params.maxResults,
          relevanceThreshold: params.relevanceThreshold,
          ...(datasets.length > 0 ? { includedSources: datasets } : {}),
          searchType: datasets.length === 0 ? 'web' : wantsWeb ? 'all' : 'proprietary',
          // NOTE: `maxPrice` is deliberately not sent. Despite the name it is
          // denominated in dollars per 1000 results, not dollars for the call,
          // and Valyu enforces a query-dependent minimum (observed: 2.00 for a
          // PubMed query, 10.00 for another) that can exceed the dataset's own
          // cpm. Passing a per-call dollar budget therefore rejects every
          // search. Spend is bounded by the local ledger, which reserves before
          // dispatch and records the measured cost afterwards, and by
          // maxNumResults.
          //
          // Signals a programmatic call rather than an interactive one.
          isToolCall: true,
          ...(params.startDate ? { startDate: params.startDate } : {}),
          ...(params.endDate ? { endDate: params.endDate } : {}),
        }),
      {
        attempts: ATTEMPTS,
        timeoutMs: TIMEOUT_MS,
        onRetry: ({ attempt, reason }) =>
          this.log.warn('valyu search retry', { attempt, reason, query: params.query }),
      },
    );

    // The SDK resolves rather than throws on an API-level failure, so this is
    // checked explicitly instead of relying on the retry wrapper.
    if (!response.success) {
      throw new Error(`Valyu search failed: ${response.error ?? 'unknown error'}`);
    }

    const outcome: ValyuSearchOutcome = {
      results: response.results ?? [],
      costUsd: response.total_deduction_dollars ?? 0,
      ...(response.tx_id ? { txId: response.tx_id } : {}),
    };

    this.log.info('valyu search complete', {
      query: params.query,
      includedSources: params.includedSources,
      datasets,
      wantsWeb,
      resultCount: outcome.results.length,
      costUsd: outcome.costUsd,
      txId: outcome.txId,
      durationMs: Date.now() - started,
    });

    return outcome;
  }
}

export type { SearchResult };
