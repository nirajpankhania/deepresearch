/**
 * Environment configuration, read and validated once at startup.
 *
 * Failing fast here means a misconfigured deploy dies on the health check rather
 * than at the moment a user submits a question.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export type DispatcherKind = 'cloudtasks' | 'local';

export interface ApiConfig {
  port: number;
  projectId: string;
  region: string;
  /** Sent by the Next.js route handler as X-API-Key. Never logged. */
  backendApiKey: string;
  allowedOrigins: string[];
  dispatcher: DispatcherKind;
  queueName: string;
  workerUrl: string;
  tasksInvokerSa: string;
  workerLocalUrl: string;
  /**
   * How long after its lease lapses a `running` task is treated as abandoned.
   *
   * Must exceed the queue's maxRetryDuration plus its longest backoff
   * (900s x 3 attempts + 300s = 3000s), or a legitimate in-flight retry would
   * find a terminal state and no-op, turning a recoverable task into a dead one.
   */
  orphanGraceSeconds: number;
}

export function loadConfig(): ApiConfig {
  const dispatcher = optional('DISPATCHER', 'cloudtasks');
  if (dispatcher !== 'cloudtasks' && dispatcher !== 'local') {
    throw new Error(`DISPATCHER must be 'cloudtasks' or 'local' (got: '${dispatcher}')`);
  }

  return {
    // Cloud Run always injects PORT and it takes precedence over API_PORT.
    port: Number(optional('PORT', optional('API_PORT', '8080'))),
    projectId: required('GCP_PROJECT_ID'),
    region: optional('GCP_REGION', 'europe-west2'),
    backendApiKey: required('BACKEND_API_KEY'),
    allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    dispatcher,
    queueName: optional('TASKS_QUEUE', 'research-tasks'),
    workerUrl: dispatcher === 'cloudtasks' ? required('WORKER_URL') : '',
    tasksInvokerSa: dispatcher === 'cloudtasks' ? required('TASKS_INVOKER_SA') : '',
    workerLocalUrl: dispatcher === 'local' ? required('WORKER_LOCAL_URL') : '',
    orphanGraceSeconds: Number(optional('ORPHAN_GRACE_SECONDS', '3600')),
  };
}
