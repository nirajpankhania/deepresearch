import { Storage } from '@google-cloud/storage';
import type { PlannedQuery, Source } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

import type { SearchResult } from './valyu.js';

/**
 * Retrieval traces in Cloud Storage.
 *
 * The raw Valyu responses are far too large for a Firestore document — a single
 * task's payloads run to hundreds of kilobytes, against a 1MB limit for the
 * whole document — but they are exactly what makes the retrieval strategy
 * auditable after the fact. A reader can see not only the twenty sources that
 * survived, but the forty that were retrieved and what was discarded.
 *
 * Written once per task, after the pipeline completes. Failure is non-fatal: the
 * report is the deliverable and losing a debugging artefact must never cost one.
 */

export interface RetrievalTrace {
  taskId: string;
  question: string;
  dateRange?: { start?: string; end?: string };
  completedAt: string;
  /** The planned sub-queries, with the rationale the planner gave for each. */
  queries: PlannedQuery[];
  /** Raw Valyu results per sub-query, before mapping, deduplication or reranking. */
  rawResults: { queryIndex: number; query: string; results: SearchResult[] }[];
  /** What survived, in final order, with the judgements that put them there. */
  selected: Source[];
  cost: { totalUsd: number; txIds: string[] };
}

export class TraceStore {
  private readonly storage = new Storage();

  constructor(
    private readonly bucket: string,
    private readonly log: Logger,
  ) {}

  /** Returns the `gs://` path, or null if the write failed. */
  async write(trace: RetrievalTrace): Promise<string | null> {
    const path = `tasks/${trace.taskId}/trace.json`;

    try {
      await this.storage
        .bucket(this.bucket)
        .file(path)
        .save(JSON.stringify(trace, null, 2), {
          contentType: 'application/json',
          // Traces are written once and never revised.
          resumable: false,
        });

      const uri = `gs://${this.bucket}/${path}`;
      this.log.info('trace written', { path: uri, rawResults: trace.rawResults.length });
      return uri;
    } catch (err: unknown) {
      this.log.warn('trace write failed, continuing without it', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
