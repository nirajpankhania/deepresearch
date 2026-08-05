/**
 * The queue boundary.
 *
 * Production uses `CloudTasksDispatcher`, which names each task `task-{taskId}`
 * so a duplicate enqueue is rejected by Cloud Tasks with 409 rather than
 * producing a second run. Local development uses `LocalHttpDispatcher`, which
 * POSTs straight to the worker and skips the queue entirely.
 *
 * Keeping this to a single method is deliberate: the queue is the one piece of
 * infrastructure with no faithful local emulator, so the surface that differs
 * between environments should be as small as possible. Everything downstream —
 * the claim transaction, the lease, the idempotency rule — runs against real
 * Firestore in both environments and is therefore never mocked.
 */
export interface TaskDispatcher {
  /**
   * Enqueue a task for processing. Must be idempotent: enqueuing an id that is
   * already queued is a no-op, not an error.
   */
  enqueue(taskId: string): Promise<void>;
}
