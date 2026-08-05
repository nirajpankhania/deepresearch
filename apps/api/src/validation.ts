import type { CreateTaskRequest, DateRange } from '@deepresearch/shared';

/**
 * Request validation, kept pure so it can be tested without a server.
 *
 * Bounds are enforced at the edge rather than deeper in the pipeline: a question
 * long enough to blow the planner's token budget should be rejected in
 * milliseconds, not after a task document exists and a queue message is in
 * flight.
 */

export const MAX_QUESTION_LENGTH = 2000;
export const MIN_QUESTION_LENGTH = 10;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(value: unknown, field: string): ValidationResult<string> {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return { ok: false, error: `${field} must be a date in YYYY-MM-DD format` };
  }
  // Rejects well-formed nonsense such as 2026-02-31, which the regex allows.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
    return { ok: false, error: `${field} is not a real date` };
  }
  return { ok: true, value };
}

export function parseCreateTaskRequest(body: unknown): ValidationResult<CreateTaskRequest> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const { question, dateRange } = body as Record<string, unknown>;

  if (typeof question !== 'string') {
    return { ok: false, error: 'question is required and must be a string' };
  }

  const trimmed = question.trim();
  if (trimmed.length < MIN_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `question must be at least ${MIN_QUESTION_LENGTH} characters`,
    };
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `question must be at most ${MAX_QUESTION_LENGTH} characters`,
    };
  }

  const result: CreateTaskRequest = { question: trimmed };

  if (dateRange !== undefined && dateRange !== null) {
    if (typeof dateRange !== 'object') {
      return { ok: false, error: 'dateRange must be an object' };
    }
    const { start, end } = dateRange as Record<string, unknown>;
    const range: DateRange = {};

    if (start !== undefined && start !== null) {
      const r = validateDate(start, 'dateRange.start');
      if (!r.ok) return r;
      range.start = r.value;
    }
    if (end !== undefined && end !== null) {
      const r = validateDate(end, 'dateRange.end');
      if (!r.ok) return r;
      range.end = r.value;
    }
    if (range.start && range.end && range.start > range.end) {
      return { ok: false, error: 'dateRange.start must not be after dateRange.end' };
    }

    if (range.start !== undefined || range.end !== undefined) result.dateRange = range;
  }

  return { ok: true, value: result };
}
