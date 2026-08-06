'use client';

import { useState } from 'react';
import type { CreateTaskResponse, DateRange } from '@deepresearch/shared';

/**
 * Domain feature 3 — the date-range control.
 *
 * Currency is often the whole question in a fast-moving field: "what does the
 * evidence say" and "what does the evidence published since the 2021 trial say"
 * are different questions with different answers. The bounds are passed through
 * to the search API rather than filtered afterwards, so the budget is spent on
 * results inside the window instead of on results that are then discarded.
 */

const EXAMPLES = [
  'Does semaglutide preserve lean muscle mass in older adults during weight loss?',
  'What is the evidence that solid-state electrolytes suppress lithium dendrite growth?',
  'How well do protein language models predict the effects of missense variants?',
];

export function SubmitForm({ onCreated }: { onCreated: (id: string, question: string) => void }) {
  const [question, setQuestion] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const dateRange: DateRange = {};
    if (start) dateRange.start = start;
    if (end) dateRange.end = end;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          ...(dateRange.start || dateRange.end ? { dateRange } : {}),
        }),
      });

      const body = (await response.json()) as CreateTaskResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not submit the question.');

      onCreated(body.id, question.trim());
      setQuestion('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not submit the question.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card-title">Ask a research question</h2>

      <label className="field">
        <span className="sr-only">Research question</span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Does semaglutide preserve lean muscle mass in older adults during weight loss?"
          required
          minLength={10}
          maxLength={2000}
          disabled={submitting}
        />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 0.9rem' }}>
        <legend className="sr-only">Restrict by publication date</legend>
        <span
          style={{
            display: 'block',
            fontSize: '0.8rem',
            fontWeight: 500,
            color: 'var(--fg-muted)',
            marginBottom: '0.35rem',
          }}
        >
          Publication date (optional)
        </span>
        <div className="dates">
          <label>
            <span className="sr-only">Published after</span>
            <input
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
              disabled={submitting}
              aria-label="Published after"
            />
          </label>
          <label>
            <span className="sr-only">Published before</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              disabled={submitting}
              aria-label="Published before"
            />
          </label>
        </div>
        <p className="hint">Narrows every search, rather than filtering results afterwards.</p>
      </fieldset>

      <button type="submit" disabled={submitting || question.trim().length < 10}>
        {submitting ? 'Submitting…' : 'Start research'}
      </button>

      {error ? (
        <div className="notice notice-error" role="alert" style={{ marginTop: '0.9rem' }}>
          <p>{error}</p>
        </div>
      ) : null}

      {question.trim() === '' ? (
        <div style={{ marginTop: '1rem' }}>
          <p className="hint" style={{ marginBottom: '0.35rem' }}>
            Or try:
          </p>
          {EXAMPLES.map((example) => (
            <p key={example} style={{ margin: '0 0 0.3rem' }}>
              <button type="button" className="link" onClick={() => setQuestion(example)}>
                {example}
              </button>
            </p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
