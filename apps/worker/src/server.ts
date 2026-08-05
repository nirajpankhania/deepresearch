import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createLogger } from '@deepresearch/shared/logger';

import { loadConfig } from './config.js';

const log = createLogger({ service: 'worker' });
const config = loadConfig();

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', role: 'worker' }));

// Phase 1 adds POST /process here: verify the Cloud Tasks OIDC token, claim the
// task in a Firestore transaction, run the pipeline, write the result.
//
// The claim rule is what makes a retried queue message safe. A task that is
// already `completed` or `failed` must return 200 and do nothing — a silent
// no-op, not an error, so Cloud Tasks stops redelivering it.

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info('worker listening', { port: info.port });
});
