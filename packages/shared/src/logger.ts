/**
 * Structured JSON logging for Cloud Logging.
 *
 * Cloud Run captures stdout and parses each line as JSON when it is valid,
 * promoting `severity` and `message` to first-class fields and keeping the rest
 * as structured payload. Anything else arrives as an opaque text blob, which is
 * unsearchable exactly when it matters.
 *
 * Not re-exported from the package index: the web app imports `@deepresearch/shared`
 * for types and must not pull server-only code into a browser bundle. Import
 * this as `@deepresearch/shared/logger`.
 */

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogFields = Record<string, unknown>;

/**
 * Field names whose values are redacted before serialisation.
 *
 * The Valyu key is passed as a constructor argument rather than being read from
 * a context object, so it should never reach a log call in the first place; this
 * is the backstop for the case where someone logs a whole config or error object.
 */
const REDACTED_KEYS = new Set([
  'apikey',
  'api_key',
  'valyu_api_key',
  'backend_api_key',
  'authorization',
  'x-api-key',
  'password',
  'token',
  'credentials',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(severity: Severity, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    severity,
    message,
    time: new Date().toISOString(),
    ...(redact(fields) as LogFields),
  });
  if (severity === 'ERROR' || severity === 'WARNING') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `bound` into every subsequent call. */
  child(bound: LogFields): Logger;
}

export function createLogger(bound: LogFields = {}): Logger {
  return {
    debug: (m, f) => emit('DEBUG', m, { ...bound, ...f }),
    info: (m, f) => emit('INFO', m, { ...bound, ...f }),
    warn: (m, f) => emit('WARNING', m, { ...bound, ...f }),
    error: (m, f) => emit('ERROR', m, { ...bound, ...f }),
    child: (extra) => createLogger({ ...bound, ...extra }),
  };
}
