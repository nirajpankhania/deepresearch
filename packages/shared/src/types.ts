/**
 * The single definition of every shape crossing a service boundary.
 *
 * Imported by the API, the worker and the web app. Nothing here may depend on
 * a Google Cloud SDK: the web app imports this package too, and pulling
 * `@google-cloud/firestore` into a browser bundle is both pointless and large.
 * Timestamps are therefore ISO 8601 strings, not Firestore `Timestamp`s. The
 * Firestore client is the only place that converts between the two.
 */

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Terminal states. A task in one of these is never claimed or re-run. */
export const TERMINAL_STATUSES = ['completed', 'failed'] as const satisfies readonly TaskStatus[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminal(status: TaskStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly TaskStatus[]).includes(status);
}

/** Pipeline stages, in order. Doubles as the progress vocabulary shown in the UI. */
export type PipelineStage =
  | 'queued'
  | 'planning'
  | 'retrieving'
  | 'deduplicating'
  | 'reranking'
  | 'synthesising'
  | 'grounding'
  | 'done';

export interface Progress {
  /** Machine-readable stage, for driving UI state. */
  step: PipelineStage;
  /** Human-readable detail, e.g. "4 of 5 searches complete". */
  message: string;
  /** 0-100. Monotonically non-decreasing within a single attempt. */
  pct: number;
}

/** Inclusive date bounds passed through to Valyu's `start_date` / `end_date`. */
export interface DateRange {
  /** ISO date, YYYY-MM-DD. */
  start?: string;
  /** ISO date, YYYY-MM-DD. */
  end?: string;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * One planned sub-query. Produced by the planning stage, surfaced verbatim in
 * the "what was searched" panel — the rationale is written for a human reader.
 */
export interface PlannedQuery {
  /** Natural-language keywords. Valyu rejects `site:`, `AND`, `OR` and quoting. */
  query: string;
  /** Valyu source presets or dataset slugs, e.g. `valyu/valyu-pubmed`. */
  includedSources: string[];
  /** Why this facet is worth searching. Shown in the UI. */
  rationale: string;
  /** Results returned after Valyu's own relevance threshold. Set post-retrieval. */
  resultCount: number;
  /** Present when the search failed; the task continues without these results. */
  error?: string;
}

/**
 * A retrieved source with Valyu's structured metadata preserved.
 *
 * Field availability varies by source type — an arXiv preprint has no journal,
 * a clinical trial has no DOI — so nearly everything is optional. Discarding
 * these down to `{ title, url }` is exactly what the brief warns against.
 */
export interface Source {
  /** Stable key used for citation numbering within a report. */
  id: string;
  title: string;
  url: string;

  /** Valyu dataset or preset this came from, e.g. `valyu/valyu-arxiv`. */
  dataset?: string;
  /** Broad classification, where Valyu reports one. */
  sourceType?: string;
  /** ISO date, YYYY-MM-DD, where a publication date is known. */
  publicationDate?: string;
  authors?: string[];

  /** Stable identifiers, in the precedence order used for deduplication. */
  doi?: string;
  arxivId?: string;
  pmid?: string;
  nctId?: string;

  /** Valyu's relevance score for the sub-query that surfaced this result. */
  relevanceScore?: number;
  /** Score from the rerank pass, computed against the original question. */
  rerankScore?: number;

  /** Extracted content, truncated before it reaches a model prompt. */
  snippet?: string;

  /** Index into `Task.queries` for the sub-query that surfaced this. */
  fromQueryIndex?: number;

  /**
   * Duplicates merged into this record — most usefully the preprint/published
   * pair, which have different DOIs and so survive identifier matching.
   */
  mergedAlternates?: MergedAlternate[];
}

export interface MergedAlternate {
  url: string;
  title?: string;
  dataset?: string;
  doi?: string;
  publicationDate?: string;
  /** Which dedup rule merged this record. */
  mergedBy: 'doi' | 'arxivId' | 'pmid' | 'nctId' | 'url' | 'title-author';
}

/**
 * Measured retrieval spend. `totalUsd` is summed from Valyu's reported
 * `total_deduction_dollars`, never estimated; `txIds` is the audit trail.
 */
export interface CostRecord {
  totalUsd: number;
  txIds: string[];
  /** Set when the per-task cap stopped further searches. */
  cappedAt?: number;
}

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

export type ClaimVerdict = 'supported' | 'partial' | 'unsupported';

export interface GroundedClaim {
  /** The citation-bearing sentence, verbatim from the report. */
  sentence: string;
  /** Source ids cited by this sentence. */
  citedSourceIds: string[];
  verdict: ClaimVerdict;
  /** One-line justification, shown on hover in the UI. */
  reason?: string;
}

export interface GroundingReport {
  claims: GroundedClaim[];
  supportedCount: number;
  totalCount: number;
  /**
   * `per-claim` is the full implementation; `report-level` is the documented
   * fallback, where only aggregate counts are meaningful.
   */
  mode: 'per-claim' | 'report-level';
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface TaskError {
  /** Written for a human reader. Must not leak stack traces or internals. */
  message: string;
  /** Pipeline stage that failed, for triage. */
  stage: PipelineStage;
}

export interface Task {
  id: string;
  question: string;
  status: TaskStatus;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;

  dateRange?: DateRange;

  /** Incremented on each claim. Bounded by the queue's maxAttempts. */
  attempt: number;
  /** ISO 8601, or null when unclaimed. A lapsed lease means the attempt died. */
  leaseExpiresAt: string | null;

  progress: Progress;

  queries: PlannedQuery[];
  sources: Source[];
  cost: CostRecord;

  /** Markdown with inline `[n]` citations. Present once completed. */
  report?: string;
  grounding?: GroundingReport;
  error?: TaskError;
  /** `gs://` path to the raw retrieval trace. */
  tracePath?: string;
}

/** Request body for `POST /tasks`. */
export interface CreateTaskRequest {
  question: string;
  dateRange?: DateRange;
}

/** Response body for `POST /tasks`. Returned before any work begins. */
export interface CreateTaskResponse {
  id: string;
  status: TaskStatus;
}
