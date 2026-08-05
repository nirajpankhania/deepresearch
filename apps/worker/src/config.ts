/**
 * Environment configuration, read and validated once at startup.
 *
 * The per-task limits live here rather than as constants in the pipeline so
 * they can be tightened on a deployed service without a rebuild — useful when
 * the thing being bounded is spend.
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

/**
 * Sentinel that forces a task to fail, when fault injection is enabled.
 *
 * The failure path — release the lease, let the queue retry, give up after the
 * attempt limit and write a readable error — is a graded requirement that is
 * otherwise only exercised by a real outage. This makes it exercisable on
 * demand, both for the smoke test and for building the frontend's failed state
 * against something that reliably fails.
 */
export const FORCE_FAILURE_SENTINEL = '__FORCE_FAILURE__';

export interface WorkerConfig {
  port: number;
  projectId: string;
  region: string;
  /** Off unless explicitly enabled. See FORCE_FAILURE_SENTINEL. */
  faultInjectionEnabled: boolean;
  /** The only third-party credential in the system. Never logged. */
  valyuApiKey: string;
  traceBucket: string;
  flashModel: string;
  proModel: string;
  limits: {
    /** Hard cap on measured Valyu spend, checked before each search dispatch. */
    maxTaskCostUsd: number;
    maxModelCalls: number;
    /** Lease duration held by a claiming worker, in seconds. */
    leaseSeconds: number;
  };
}

export function loadConfig(): WorkerConfig {
  return {
    port: Number(optional('PORT', optional('WORKER_PORT', '8081'))),
    projectId: required('GCP_PROJECT_ID'),
    region: optional('GCP_REGION', 'europe-west2'),
    faultInjectionEnabled: optional('FAULT_INJECTION_ENABLED', 'false') === 'true',
    valyuApiKey: required('VALYU_API_KEY'),
    traceBucket: required('GCS_TRACE_BUCKET'),
    flashModel: required('GEMINI_FLASH_MODEL'),
    proModel: required('GEMINI_PRO_MODEL'),
    limits: {
      maxTaskCostUsd: Number(optional('MAX_TASK_COST_USD', '0.30')),
      maxModelCalls: Number(optional('MAX_MODEL_CALLS', '12')),
      leaseSeconds: Number(optional('LEASE_SECONDS', '900')),
    },
  };
}
