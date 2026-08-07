import type { Task } from '@deepresearch/shared';

/**
 * Trims a task for streaming.
 *
 * Source snippets are the extracted text of each document — up to 12k characters
 * apiece, 110KB across a corpus, and **83% of every frame**. Nothing in the
 * interface renders them: the cards show title, metadata and identifiers, and
 * grounding references sources by id. Sending them on every draft update was
 * shipping a tenth of a megabyte to redraw one paragraph.
 *
 * They remain in Firestore and in `GET /tasks/:id`, so nothing is lost for
 * anyone inspecting the API directly.
 */
export function forStream(task: Task): Task {
  return {
    ...task,
    sources: task.sources.map(({ snippet: _omitted, ...rest }) => rest),
  };
}

/**
 * A signature of everything that warrants sending the whole task.
 *
 * Deliberately an explicit list rather than a hash of the serialised document.
 * Comparing `JSON.stringify` output looked simpler and did not work: Firestore
 * does not guarantee map field ordering between snapshots, so two semantically
 * identical documents serialise to different bytes and every frame was treated
 * as a full change. Naming the fields that matter is both correct and easier to
 * reason about.
 *
 * Timestamps are excluded on purpose — publishing a draft updates them, and
 * including them would defeat the whole optimisation.
 */
export function frameSignature(task: Task): string {
  return JSON.stringify([
    task.status,
    task.progress.step,
    task.progress.pct,
    task.progress.message,
    task.queries.map((q) => `${q.done ? 1 : 0}:${q.resultCount}:${q.costUsd ?? ''}:${q.error ?? ''}`),
    task.sources.length,
    task.report === undefined ? 0 : task.report.length,
    task.grounding?.totalCount ?? -1,
    task.cost.totalUsd,
    task.cost.txIds.length,
    task.error?.message ?? '',
  ]);
}
