/**
 * Task persistence, and the claim transaction that makes retries safe.
 *
 * Shared by the API and the worker because they read and write the same
 * document shape; duplicating the conversion or the claim rule across two
 * services would be duplicating exactly the logic that must not drift.
 *
 * Not re-exported from the package index — the web app imports `@deepresearch/shared`
 * for types and must not pull the Firestore SDK into a browser bundle. Import
 * this as `@deepresearch/shared/firestore`.
 */

import {
  FieldValue,
  Firestore,
  Timestamp,
  type DocumentSnapshot,
} from '@google-cloud/firestore';

import type {
  CostRecord,
  DateRange,
  GroundingReport,
  PlannedQuery,
  Progress,
  Source,
  Task,
  TaskError,
} from './types.js';
import { isOrphaned, isTerminal } from './types.js';

const COLLECTION = 'tasks';

/**
 * Stored form of a task. Dates are Firestore `Timestamp`s here and ISO strings
 * on `Task`; this module is the only place that knows both.
 */
interface TaskDoc {
  id: string;
  question: string;
  status: Task['status'];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  dateRange?: DateRange;
  attempt: number;
  leaseExpiresAt: Timestamp | null;
  progress: Progress;
  queries: PlannedQuery[];
  sources: Source[];
  cost: CostRecord;
  report?: string;
  reportDraft?: string;
  grounding?: GroundingReport;
  error?: TaskError;
  tracePath?: string;
}

function toTask(snap: DocumentSnapshot): Task | null {
  const d = snap.data() as TaskDoc | undefined;
  if (!d) return null;

  // Optional fields are assigned conditionally rather than set to undefined,
  // because `exactOptionalPropertyTypes` distinguishes absent from undefined.
  const task: Task = {
    id: snap.id,
    question: d.question,
    status: d.status,
    createdAt: d.createdAt.toDate().toISOString(),
    updatedAt: d.updatedAt.toDate().toISOString(),
    attempt: d.attempt ?? 0,
    leaseExpiresAt: d.leaseExpiresAt ? d.leaseExpiresAt.toDate().toISOString() : null,
    progress: d.progress,
    queries: d.queries ?? [],
    sources: d.sources ?? [],
    cost: d.cost ?? { totalUsd: 0, txIds: [] },
  };

  if (d.dateRange) task.dateRange = d.dateRange;
  if (d.report !== undefined) task.report = d.report;
  if (d.reportDraft !== undefined) task.reportDraft = d.reportDraft;
  if (d.grounding) task.grounding = d.grounding;
  if (d.error) task.error = d.error;
  if (d.tracePath) task.tracePath = d.tracePath;

  return task;
}

/** Outcome of attempting to claim a task. Every case is a normal outcome, not an error. */
export type ClaimOutcome =
  /** This worker now owns the task and must run it. */
  | { outcome: 'claimed'; task: Task }
  /**
   * Already `completed` or `failed`. The caller must return 200 and do nothing:
   * this is a redelivered queue message, and responding with an error would make
   * Cloud Tasks keep retrying the message it is trying to stop sending.
   */
  | { outcome: 'already-terminal'; task: Task }
  /** Another worker holds an unexpired lease. Also a 200 — not this worker's job. */
  | { outcome: 'lease-held'; task: Task }
  /** No such document. */
  | { outcome: 'not-found' };

export class TaskRepository {
  constructor(private readonly db: Firestore) {}

  static forProject(projectId: string): TaskRepository {
    return new TaskRepository(new Firestore({ projectId }));
  }

  async create(id: string, question: string, dateRange?: DateRange): Promise<Task> {
    const now = Timestamp.now();
    const doc: TaskDoc = {
      id,
      question,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      attempt: 0,
      leaseExpiresAt: null,
      progress: { step: 'queued', message: 'Waiting to start', pct: 0 },
      queries: [],
      sources: [],
      cost: { totalUsd: 0, txIds: [] },
      ...(dateRange ? { dateRange } : {}),
    };

    await this.db.collection(COLLECTION).doc(id).create(doc);

    const created = await this.get(id);
    if (!created) throw new Error(`task ${id} vanished immediately after creation`);
    return created;
  }

  async get(id: string): Promise<Task | null> {
    return toTask(await this.db.collection(COLLECTION).doc(id).get());
  }

  /**
   * Claim a task for processing, in a transaction.
   *
   * Claimable when `queued`, or when `running` with a lapsed lease — the latter
   * means the previous attempt died without writing a terminal state, and the
   * task would otherwise be stranded forever.
   */
  async claim(id: string, leaseSeconds: number): Promise<ClaimOutcome> {
    const ref = this.db.collection(COLLECTION).doc(id);

    return this.db.runTransaction<ClaimOutcome>(async (tx) => {
      const snap = await tx.get(ref);
      const task = toTask(snap);
      if (!task) return { outcome: 'not-found' };

      if (isTerminal(task.status)) return { outcome: 'already-terminal', task };

      const leaseLive =
        task.leaseExpiresAt !== null && new Date(task.leaseExpiresAt).getTime() > Date.now();
      if (task.status === 'running' && leaseLive) return { outcome: 'lease-held', task };

      const now = Timestamp.now();
      const leaseExpiresAt = Timestamp.fromMillis(now.toMillis() + leaseSeconds * 1000);
      const attempt = task.attempt + 1;
      const progress: Progress = { step: 'planning', message: 'Starting research', pct: 5 };

      tx.update(ref, { status: 'running', attempt, leaseExpiresAt, updatedAt: now, progress });

      return {
        outcome: 'claimed',
        task: {
          ...task,
          status: 'running',
          attempt,
          leaseExpiresAt: leaseExpiresAt.toDate().toISOString(),
          updatedAt: now.toDate().toISOString(),
          progress,
        },
      };
    });
  }

  /**
   * Publish the planned sub-queries as soon as they exist, rather than at the
   * end with the report.
   *
   * The queries are the most interesting thing happening during the two minutes
   * a task runs, and holding them back until completion meant the "what was
   * searched" panel sat empty for the whole time — the user could see *that*
   * something was happening but not *what*.
   */
  async publishQueries(id: string, queries: PlannedQuery[], leaseSeconds: number): Promise<void> {
    const now = Timestamp.now();
    await this.db
      .collection(COLLECTION)
      .doc(id)
      .update({
        queries,
        updatedAt: now,
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + leaseSeconds * 1000),
      });
  }

  /**
   * Publish the selected corpus once reranking has chosen it.
   *
   * Written before synthesis rather than with the report, so the source cards
   * and the citation targets exist while the report is still streaming — a
   * citation appearing in draft text should resolve immediately, not forty
   * seconds later.
   */
  async publishSources(id: string, sources: Source[], leaseSeconds: number): Promise<void> {
    const now = Timestamp.now();
    await this.db
      .collection(COLLECTION)
      .doc(id)
      .update({
        sources,
        updatedAt: now,
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + leaseSeconds * 1000),
      });
  }

  /**
   * Publish partial report text while synthesis streams.
   *
   * Written to `reportDraft`, never `report`: only the latter is a finished
   * document, and a draft abandoned by a failed attempt must not be readable as
   * a completed report.
   */
  async publishDraft(id: string, reportDraft: string, leaseSeconds: number): Promise<void> {
    const now = Timestamp.now();
    await this.db
      .collection(COLLECTION)
      .doc(id)
      .update({
        reportDraft,
        updatedAt: now,
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + leaseSeconds * 1000),
      });
  }

  /**
   * Streams every change to a task until it reaches a terminal state.
   *
   * Backs the SSE endpoint. Returns an unsubscribe function the caller must
   * invoke when the client disconnects, or the listener outlives the request and
   * leaks for as long as the instance survives.
   */
  watch(id: string, onChange: (task: Task) => void, onError: (err: Error) => void): () => void {
    return this.db
      .collection(COLLECTION)
      .doc(id)
      .onSnapshot(
        (snap) => {
          const task = toTask(snap);
          if (task) onChange(task);
        },
        (err) => onError(err instanceof Error ? err : new Error(String(err))),
      );
  }

  /** Report progress and extend the lease, so a long but healthy task is not reclaimed. */
  async reportProgress(id: string, progress: Progress, leaseSeconds: number): Promise<void> {
    const now = Timestamp.now();
    await this.db
      .collection(COLLECTION)
      .doc(id)
      .update({
        progress,
        updatedAt: now,
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + leaseSeconds * 1000),
      });
  }

  /**
   * Return a task to `queued` and drop the lease, after an attempt failed in a
   * way that is worth retrying.
   *
   * Without this the retry would find the task `running` with a lease this
   * worker still nominally holds, treat it as another worker's job, and no-op —
   * so the task would stall until the lease expired, which for a 900s lease
   * means it effectively never retries.
   */
  async release(id: string, message: string): Promise<void> {
    const now = Timestamp.now();
    await this.db.collection(COLLECTION).doc(id).update({
      status: 'queued',
      leaseExpiresAt: null,
      updatedAt: now,
      progress: { step: 'queued', message, pct: 0 },
    });
  }

  /**
   * Write the result and flip to `completed` in a single transaction, so there
   * is no window in which a task reads as complete but has no report.
   *
   * Re-checks terminality inside the transaction: a task that reached a terminal
   * state while this attempt was running must not be overwritten.
   */
  async complete(id: string, result: CompletionResult): Promise<'written' | 'already-terminal'> {
    const ref = this.db.collection(COLLECTION).doc(id);

    return this.db.runTransaction(async (tx) => {
      const task = toTask(await tx.get(ref));
      if (!task) throw new Error(`task ${id} not found`);
      if (isTerminal(task.status)) return 'already-terminal';

      tx.update(ref, {
        status: 'completed',
        report: result.report,
        // The finished report supersedes the draft; leaving both would let a
        // stale partial render alongside the real thing.
        reportDraft: FieldValue.delete(),
        queries: result.queries,
        sources: result.sources,
        cost: result.cost,
        progress: { step: 'done', message: 'Report ready', pct: 100 },
        leaseExpiresAt: null,
        updatedAt: Timestamp.now(),
        ...(result.grounding ? { grounding: result.grounding } : {}),
        ...(result.tracePath ? { tracePath: result.tracePath } : {}),
      });

      return 'written';
    });
  }

  /**
   * Marks an abandoned task as failed, if it is genuinely abandoned.
   *
   * Called lazily on read rather than by a scheduled sweeper. A sweeper would be
   * more thorough but needs Cloud Scheduler, another service account and another
   * endpoint to secure; reading is the only moment anyone is waiting on the
   * answer, so it is also the only moment the correction matters.
   *
   * Re-checks the condition inside the transaction, because the whole risk here
   * is racing a delivery that is about to claim the task legitimately.
   */
  async reapIfOrphaned(id: string, graceSeconds: number): Promise<Task | null> {
    const ref = this.db.collection(COLLECTION).doc(id);

    return this.db.runTransaction<Task | null>(async (tx) => {
      const task = toTask(await tx.get(ref));
      if (!task || !isOrphaned(task, graceSeconds)) return null;

      const error: TaskError = {
        message:
          'This task stopped unexpectedly and did not finish. The service was interrupted while researching and has stopped retrying. Please submit the question again.',
        stage: task.progress.step,
      };
      const now = Timestamp.now();

      tx.update(ref, {
        status: 'failed',
        error,
        progress: { step: task.progress.step, message: error.message, pct: task.progress.pct },
        leaseExpiresAt: null,
        updatedAt: now,
      });

      return {
        ...task,
        status: 'failed',
        error,
        leaseExpiresAt: null,
        updatedAt: now.toDate().toISOString(),
      };
    });
  }

  /** Terminal failure with an error a human can act on. */
  async fail(id: string, error: TaskError): Promise<'written' | 'already-terminal'> {
    const ref = this.db.collection(COLLECTION).doc(id);

    return this.db.runTransaction(async (tx) => {
      const task = toTask(await tx.get(ref));
      if (!task) throw new Error(`task ${id} not found`);
      if (isTerminal(task.status)) return 'already-terminal';

      tx.update(ref, {
        status: 'failed',
        error,
        progress: { step: task.progress.step, message: error.message, pct: task.progress.pct },
        leaseExpiresAt: null,
        updatedAt: Timestamp.now(),
      });

      return 'written';
    });
  }
}

export interface CompletionResult {
  report: string;
  queries: PlannedQuery[];
  sources: Source[];
  cost: CostRecord;
  grounding?: GroundingReport;
  tracePath?: string;
}
