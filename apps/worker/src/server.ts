import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { TaskRepository } from '@deepresearch/shared/firestore';
import { createLogger } from '@deepresearch/shared/logger';

import { GeminiClient } from './clients/gemini.js';
import { ValyuClient } from './clients/valyu.js';
import { loadConfig } from './config.js';
import { runPipeline } from './pipeline/index.js';

const log = createLogger({ service: 'worker' });
const config = loadConfig();
const tasks = TaskRepository.forProject(config.projectId);

const valyu = new ValyuClient(config.valyuApiKey, log);

/**
 * Attempts beyond this are not retried. Must match the queue's maxAttempts:
 * the worker decides when to give up, because only the worker can write a
 * useful error message into the task document.
 */
const MAX_ATTEMPTS = 3;

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', role: 'worker' }));

/**
 * Called by Cloud Tasks with an OIDC token.
 *
 * The token is not verified here: the Cloud Run service requires
 * `roles/run.invoker`, which is granted to the Cloud Tasks invoker service
 * account and nothing else, so an unauthenticated request never reaches this
 * container. Re-verifying in application code would duplicate a check the
 * platform already enforces, and a bug in the duplicate could only make things
 * worse.
 *
 * Status codes are the contract with the queue, and matter more than usual:
 *   200  done, or nothing to do — stop redelivering
 *   500  this attempt failed but is worth retrying
 */
app.post('/process', async (c) => {
  let taskId: string;
  try {
    const body = (await c.req.json()) as { taskId?: unknown };
    if (typeof body.taskId !== 'string' || body.taskId === '') {
      return c.json({ error: 'taskId is required' }, 400);
    }
    taskId = body.taskId;
  } catch {
    // Malformed body will never become well-formed on redelivery.
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const taskLog = log.child({ taskId });

  const claim = await tasks.claim(taskId, config.limits.leaseSeconds);

  switch (claim.outcome) {
    case 'not-found':
      // Nothing to retry against.
      taskLog.warn('process called for unknown task');
      return c.json({ status: 'not-found' }, 200);

    case 'already-terminal':
      // The retried-message case the brief calls out. A silent no-op, and
      // deliberately 200: any error status would make Cloud Tasks redeliver the
      // very message it is trying to stop sending.
      taskLog.info('task already terminal, ignoring redelivery', { status: claim.task.status });
      return c.json({ status: claim.task.status }, 200);

    case 'lease-held':
      taskLog.info('task claimed by another attempt, ignoring');
      return c.json({ status: 'in-progress' }, 200);

    case 'claimed':
      break;
  }

  const { task } = claim;
  taskLog.info('task claimed', { attempt: task.attempt });

  try {
    const result = await runPipeline({
      task,
      log: taskLog,
      onProgress: (progress) => tasks.reportProgress(taskId, progress, config.limits.leaseSeconds),
      faultInjectionEnabled: config.faultInjectionEnabled,
      publish: {
        queries: (queries) => tasks.publishQueries(taskId, queries, config.limits.leaseSeconds),
        sources: (sources) => tasks.publishSources(taskId, sources, config.limits.leaseSeconds),
        draft: (partial) => tasks.publishDraft(taskId, partial, config.limits.leaseSeconds),
      },
      valyu,
      // Constructed per task, because the call counter is a per-task step limit.
      gemini: new GeminiClient({
        projectId: config.projectId,
        flashModel: config.flashModel,
        proModel: config.proModel,
        maxCalls: config.limits.maxModelCalls,
        log: taskLog,
      }),
      limits: {
        maxTaskCostUsd: config.limits.maxTaskCostUsd,
        maxResultsPerQuery: config.retrieval.maxResultsPerQuery,
        relevanceThreshold: config.retrieval.relevanceThreshold,
        maxSources: config.retrieval.maxSources,
      },
    });

    const written = await tasks.complete(taskId, result);
    taskLog.info('task finished', { outcome: written, reportLength: result.report.length });
    return c.json({ status: 'completed' }, 200);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    taskLog.error('attempt failed', { attempt: task.attempt, reason });

    if (task.attempt >= MAX_ATTEMPTS) {
      // Out of attempts: write a terminal failure a human can read, and return
      // 200 so the queue stops. The internal reason stays in the logs.
      await tasks.fail(taskId, {
        message:
          'Research failed after multiple attempts. This is usually a temporary problem with an upstream service — please try submitting the question again.',
        stage: task.progress.step,
      });
      taskLog.error('task failed permanently', { attempts: task.attempt });
      return c.json({ status: 'failed' }, 200);
    }

    // Retryable: hand the task back before returning 500, or the redelivery
    // would see a live lease and skip it.
    await tasks.release(taskId, 'Retrying after a temporary failure');
    return c.json({ status: 'retry' }, 500);
  }
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info('worker listening', { port: info.port });
});
