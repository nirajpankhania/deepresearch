import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createLogger } from '@deepresearch/shared/logger';

import { loadConfig } from './config.js';

const log = createLogger({ service: 'api' });
const config = loadConfig();

const app = new Hono();

/**
 * Liveness only. It deliberately does not check Firestore or the queue: a
 * dependency blip should surface as a failed request with a useful error, not
 * as Cloud Run cycling every instance.
 */
app.get('/health', (c) => c.json({ status: 'ok', role: 'api' }));

// Phase 1 adds POST /tasks and GET /tasks/:task_id here.

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info('api listening', { port: info.port, dispatcher: config.dispatcher });
});
