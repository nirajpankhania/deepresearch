import { CloudTasksClient } from '@google-cloud/tasks';
import type { TaskDispatcher } from '@deepresearch/shared';
import type { Logger } from '@deepresearch/shared/logger';

/**
 * Production dispatcher.
 *
 * Each task is named `task-{taskId}`, which is what makes enqueue idempotent:
 * Cloud Tasks rejects a second task with the same name, so a retried or
 * duplicated submission cannot produce two runs. That rejection is the expected
 * path, not an error, and is swallowed below.
 *
 * The request carries an OIDC token for the invoker service account, so the
 * worker can require an authenticated invoker and never be publicly reachable.
 */
export class CloudTasksDispatcher implements TaskDispatcher {
  private readonly client = new CloudTasksClient();

  constructor(
    private readonly opts: {
      projectId: string;
      region: string;
      queueName: string;
      workerUrl: string;
      invokerServiceAccount: string;
      log: Logger;
    },
  ) {}

  async enqueue(taskId: string): Promise<void> {
    const { projectId, region, queueName, workerUrl, invokerServiceAccount, log } = this.opts;
    const parent = this.client.queuePath(projectId, region, queueName);

    try {
      await this.client.createTask({
        parent,
        task: {
          name: `${parent}/tasks/task-${taskId}`,
          httpRequest: {
            httpMethod: 'POST',
            url: `${workerUrl}/process`,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ taskId })).toString('base64'),
            oidcToken: {
              serviceAccountEmail: invokerServiceAccount,
              audience: workerUrl,
            },
          },
        },
      });
      log.info('task enqueued', { taskId });
    } catch (err: unknown) {
      // gRPC ALREADY_EXISTS. The task is already queued, which is the outcome
      // we wanted; treating this as a failure would turn a correct no-op into a
      // 500 for the caller.
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 6) {
        log.info('task already enqueued, ignoring duplicate', { taskId });
        return;
      }
      throw err;
    }
  }
}

/**
 * Development dispatcher: POST straight to the worker, no queue.
 *
 * Deliberately fire-and-forget, to preserve the property that matters for
 * testing — `POST /tasks` returns before any work begins. It gives up retries
 * and duplicate rejection, which is why it is never used in production.
 */
export class LocalHttpDispatcher implements TaskDispatcher {
  constructor(
    private readonly opts: { workerUrl: string; log: Logger },
  ) {}

  async enqueue(taskId: string): Promise<void> {
    const { workerUrl, log } = this.opts;

    void fetch(`${workerUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    }).catch((err: unknown) => {
      log.error('local dispatch failed', {
        taskId,
        reason: err instanceof Error ? err.message : String(err),
      });
    });

    log.info('task dispatched locally', { taskId });
  }
}
