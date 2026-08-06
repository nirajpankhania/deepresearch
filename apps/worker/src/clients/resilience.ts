/**
 * Timeout and bounded retry for external calls.
 *
 * One rule matters more than the rest: retry transport failures and 5xx, never
 * other 4xx. A 400 or a 401 will fail identically on the second attempt, and
 * with Valyu each attempt is billable — so retrying a client error spends money
 * to obtain the same rejection.
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Wraps a call so it rejects if it outlives `ms`, aborting it where supported. */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls an HTTP status off the various shapes SDKs use to report one. */
export function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as Record<string, unknown>;

  for (const key of ['status', 'statusCode', 'code']) {
    const v = e[key];
    if (typeof v === 'number' && v >= 100 && v < 600) return v;
  }
  const response = e['response'] as Record<string, unknown> | undefined;
  if (response && typeof response['status'] === 'number') return response['status'] as number;

  return undefined;
}

/**
 * Whether a failure is worth another attempt.
 *
 * Retryable: no status at all (DNS, connection reset, timeout), any 5xx, and
 * 429 — rate limiting is explicitly a "try again" signal. Everything else,
 * notably 400/401/403/404, is not.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;

  const status = statusOf(err);
  if (status === undefined) return true;
  if (status === 429) return true;
  return status >= 500;
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Base for exponential backoff. */
  baseDelayMs?: number;
  retryable?: (err: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  /** Injectable for tests, so backoff does not make the suite slow. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function callWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    attempts,
    timeoutMs,
    baseDelayMs = 500,
    retryable = isRetryable,
    onRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(async (signal) => {
        const result = fn(signal);
        // Surface the abort as a TimeoutError rather than whatever the SDK does
        // with a cancelled signal, which varies and is often silence.
        return await Promise.race([
          result,
          new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(new TimeoutError(timeoutMs)), {
              once: true,
            });
          }),
        ]);
      }, timeoutMs);
    } catch (err: unknown) {
      lastError = err;

      const isLast = attempt === attempts;
      if (isLast || !retryable(err)) throw err;

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry?.({
        attempt,
        delayMs,
        reason: err instanceof Error ? err.message : String(err),
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
