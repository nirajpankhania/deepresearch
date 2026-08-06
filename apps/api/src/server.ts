import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isOrphaned, type TaskDispatcher } from '@deepresearch/shared';
import { TaskRepository } from '@deepresearch/shared/firestore';
import { createLogger } from '@deepresearch/shared/logger';

import { requireApiKey } from './auth.js';
import { loadConfig } from './config.js';
import { CloudTasksDispatcher, LocalHttpDispatcher } from './dispatchers.js';
import { parseCreateTaskRequest } from './validation.js';

const log = createLogger({ service: 'api' });
const config = loadConfig();
const tasks = TaskRepository.forProject(config.projectId);

const dispatcher: TaskDispatcher =
  config.dispatcher === 'cloudtasks'
    ? new CloudTasksDispatcher({
        projectId: config.projectId,
        region: config.region,
        queueName: config.queueName,
        workerUrl: config.workerUrl,
        invokerServiceAccount: config.tasksInvokerSa,
        log,
      })
    : new LocalHttpDispatcher({ workerUrl: config.workerLocalUrl, log });

const app = new Hono();

app.use(
  '/tasks/*',
  cors({
    origin: config.allowedOrigins,
    allowHeaders: ['Content-Type', 'X-API-Key'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

/** Liveness only — deliberately does not probe Firestore. See docs/design.md. */
app.get('/health', (c) => c.json({ status: 'ok', role: 'api' }));

app.use('/tasks', requireApiKey(config.backendApiKey));
app.use('/tasks/*', requireApiKey(config.backendApiKey));

/**
 * Accept a question and return immediately. The document is written before the
 * task is enqueued, so a queue message can never reference a task that does not
 * exist; the reverse ordering would be a race.
 */
app.post('/tasks', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const parsed = parseCreateTaskRequest(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const id = randomUUID();

  try {
    await tasks.create(id, parsed.value.question, parsed.value.dateRange);
  } catch (err: unknown) {
    log.error('failed to create task document', {
      taskId: id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Could not accept the task. Please retry.' }, 503);
  }

  try {
    await dispatcher.enqueue(id);
  } catch (err: unknown) {
    // The document exists but nothing will pick it up, so say so rather than
    // leaving the caller polling a task that will never start.
    log.error('failed to enqueue task', {
      taskId: id,
      reason: err instanceof Error ? err.message : String(err),
    });
    await tasks.fail(id, {
      message: 'The task could not be queued for processing. Please submit it again.',
      stage: 'queued',
    });
    return c.json({ error: 'Could not queue the task. Please retry.' }, 503);
  }

  log.info('task accepted', { taskId: id, questionLength: parsed.value.question.length });
  return c.json({ id, status: 'queued' }, 202);
});

app.get('/tasks/:task_id', async (c) => {
  const id = c.req.param('task_id');

  const task = await tasks.get(id);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  // A task whose worker died on every delivery is left `running` with a lapsed
  // lease and nothing to reclaim it, because the queue has exhausted its
  // attempts. Correct it here — reading is the only moment anyone is waiting on
  // the answer, so it is the only moment the correction matters.
  if (isOrphaned(task, config.orphanGraceSeconds)) {
    const reaped = await tasks.reapIfOrphaned(id, config.orphanGraceSeconds);
    if (reaped) {
      log.warn('reaped orphaned task', {
        taskId: id,
        attempt: reaped.attempt,
        stage: reaped.error?.stage,
      });
      return c.json(reaped);
    }
  }

  return c.json(task);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info('api listening', { port: info.port, dispatcher: config.dispatcher });
});
