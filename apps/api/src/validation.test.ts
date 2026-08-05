import { describe, expect, it } from 'vitest';

import { MAX_QUESTION_LENGTH, parseCreateTaskRequest } from './validation.js';

describe('parseCreateTaskRequest', () => {
  const validQuestion = 'Does semaglutide preserve muscle mass in older adults?';

  it('accepts a well-formed question and trims it', () => {
    const r = parseCreateTaskRequest({ question: `  ${validQuestion}  ` });
    expect(r).toEqual({ ok: true, value: { question: validQuestion } });
  });

  it('omits dateRange entirely when not supplied', () => {
    const r = parseCreateTaskRequest({ question: validQuestion });
    expect(r.ok && 'dateRange' in r.value).toBe(false);
  });

  it.each([
    ['null body', null],
    ['a string body', 'question'],
    ['a missing question', {}],
    ['a non-string question', { question: 42 }],
  ])('rejects %s', (_label, body) => {
    expect(parseCreateTaskRequest(body).ok).toBe(false);
  });

  it('rejects a question that is too short, measured after trimming', () => {
    const r = parseCreateTaskRequest({ question: '   hi   ' });
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects a question over the length cap', () => {
    const r = parseCreateTaskRequest({ question: 'a'.repeat(MAX_QUESTION_LENGTH + 1) });
    expect(r).toMatchObject({ ok: false });
  });

  describe('dateRange', () => {
    it('accepts start and end together', () => {
      const r = parseCreateTaskRequest({
        question: validQuestion,
        dateRange: { start: '2020-01-01', end: '2024-12-31' },
      });
      expect(r).toEqual({
        ok: true,
        value: { question: validQuestion, dateRange: { start: '2020-01-01', end: '2024-12-31' } },
      });
    });

    it('accepts a start with no end', () => {
      const r = parseCreateTaskRequest({
        question: validQuestion,
        dateRange: { start: '2020-01-01' },
      });
      expect(r).toEqual({
        ok: true,
        value: { question: validQuestion, dateRange: { start: '2020-01-01' } },
      });
    });

    it('treats an empty dateRange as absent', () => {
      const r = parseCreateTaskRequest({ question: validQuestion, dateRange: {} });
      expect(r.ok && 'dateRange' in r.value).toBe(false);
    });

    it.each(['2020-1-1', '01-01-2020', 'yesterday', '2020-01-01T00:00:00Z'])(
      'rejects malformed date %s',
      (start) => {
        expect(parseCreateTaskRequest({ question: validQuestion, dateRange: { start } }).ok).toBe(
          false,
        );
      },
    );

    // Well-formed but not a real date — the regex alone would let this through.
    it('rejects 31 February', () => {
      const r = parseCreateTaskRequest({
        question: validQuestion,
        dateRange: { start: '2026-02-31' },
      });
      expect(r).toMatchObject({ ok: false });
    });

    it('rejects an inverted range', () => {
      const r = parseCreateTaskRequest({
        question: validQuestion,
        dateRange: { start: '2024-01-01', end: '2020-01-01' },
      });
      expect(r).toMatchObject({ ok: false });
    });
  });
});
