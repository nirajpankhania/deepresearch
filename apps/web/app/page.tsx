'use client';

import { useCallback, useEffect, useState } from 'react';

import { Grounding } from '@/components/grounding';
import { Report } from '@/components/report';
import { SearchPanel } from '@/components/search-panel';
import { SubmitForm } from '@/components/submit-form';
import { Progress, StatusBadge } from '@/components/status';
import { useTask } from '@/hooks/use-task';

/**
 * Submitted tasks are remembered in localStorage so a refresh does not lose
 * them. There is no user account, so the browser is the only place this can
 * live; task state itself is durable server-side, and this is just the index.
 */
const STORAGE_KEY = 'deepresearch.tasks.v1';

interface Submitted {
  id: string;
  question: string;
  at: string;
}

function load(): Submitted[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Submitted[]) : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [tasks, setTasks] = useState<Submitted[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = load();
    setTasks(stored);
    setSelected(stored[0]?.id ?? null);
    setHydrated(true);
  }, []);

  const { task, loadError, isPolling } = useTask(selected);

  const onCreated = useCallback((id: string, question: string) => {
    setTasks((previous) => {
      const next = [{ id, question, at: new Date().toISOString() }, ...previous].slice(0, 20);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A full or disabled localStorage must not break submission.
      }
      return next;
    });
    setSelected(id);
  }, []);

  return (
    <div className="shell">
      <header className="masthead">
        <p className="eyebrow">Scientific literature</p>
        <h1>DeepResearch</h1>
        <p>
          Asks a research question across papers, preprints, clinical trials and patents, then
          returns a report you can check — every claim cited, every search shown.
        </p>
      </header>

      <div className="columns">
        <main>
          {!hydrated ? null : !selected ? (
            <p className="empty">Ask a question to begin. Reports usually take a minute or two.</p>
          ) : loadError && !task ? (
            <div className="notice notice-error" role="alert">
              <h3>Could not load this task</h3>
              <p>{loadError}</p>
            </div>
          ) : !task ? (
            <p className="empty">Loading…</p>
          ) : (
            <>
              <section className="card" aria-live="polite">
                <div
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 500, lineHeight: 1.45 }}>{task.question}</p>
                  <StatusBadge status={task.status} />
                </div>

                {task.dateRange?.start || task.dateRange?.end ? (
                  <p className="hint" style={{ marginTop: '0.5rem' }}>
                    Restricted to {task.dateRange.start ?? 'any date'} → {task.dateRange.end ?? 'today'}
                  </p>
                ) : null}

                {task.status === 'queued' || task.status === 'running' ? (
                  <Progress task={task} />
                ) : null}
              </section>

              {/*
                A failed task states what went wrong, using the message the
                backend stored. Showing a generic failure here would leave the
                user unable to tell a transient outage from a bad question.
              */}
              {task.status === 'failed' ? (
                <div className="notice notice-error" role="alert" style={{ marginTop: '1rem' }}>
                  <h3>This research task failed</h3>
                  <p>{task.error?.message ?? 'The task failed without recording a reason.'}</p>
                  {task.error?.stage ? (
                    <p className="hint" style={{ marginTop: '0.4rem' }}>
                      Failed during: {task.error.stage} · after {task.attempt} attempt
                      {task.attempt === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {task.status === 'completed' && task.report ? (
                <div style={{ marginTop: '2rem' }}>
                  <Report report={task.report} sources={task.sources} />
                  {task.grounding ? (
                    <Grounding grounding={task.grounding} sources={task.sources} />
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </main>

        <aside className="rail">
          <SubmitForm onCreated={onCreated} />

          {task && task.queries.length > 0 ? <SearchPanel task={task} /> : null}

          {tasks.length > 0 ? (
            <section className="card">
              <h2 className="card-title">Your tasks</h2>
              <ul className="task-list">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="task-item"
                      aria-current={t.id === selected}
                      onClick={() => setSelected(t.id)}
                    >
                      <q>{t.question}</q>
                      <span className="hint">
                        {new Date(t.at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {t.id === selected && isPolling ? ' · updating' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
