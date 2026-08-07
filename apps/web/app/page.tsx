'use client';

import { useCallback, useEffect, useState } from 'react';

import { CostPanel } from '@/components/cost-panel';
import { Grounding } from '@/components/grounding';
import { Report } from '@/components/report';
import { SearchPanel } from '@/components/search-panel';
import { SubmitForm } from '@/components/submit-form';
import { Progress, StatusBadge } from '@/components/status';
import { useTask } from '@/hooks/use-task';
import { useTypewriter } from '@/hooks/use-typewriter';

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
  const [composing, setComposing] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = load();
    setTasks(stored);
    setSelected(stored[0]?.id ?? null);
    setComposing(stored.length === 0);
    setHydrated(true);
  }, []);

  const { task, loadError, transport } = useTask(selected);

  const onCreated = useCallback((id: string, question: string) => {
    setTasks((previous) => {
      const next = [{ id, question, at: new Date().toISOString() }, ...previous].slice(0, 30);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A full or disabled localStorage must not break submission.
      }
      return next;
    });
    setSelected(id);
    setComposing(false);
  }, []);

  const live = task?.status === 'running' || task?.status === 'queued';
  const streamingReport = task?.status === 'running' && Boolean(task.reportDraft);

  // Smooths the bursts the transport delivers into a continuous reveal. Text
  // cannot stream per-token from the worker — it crosses Firestore and two
  // services — so the pacing happens here.
  const revealed = useTypewriter(task?.reportDraft ?? '', Boolean(streamingReport));

  const remove = useCallback(
    async (id: string) => {
      setTasks((previous) => {
        const next = previous.filter((t) => t.id !== id);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Losing the local index is survivable; the delete still happened.
        }
        return next;
      });

      setSelected((current) => (current === id ? null : current));
      setComposing((current) => current || selected === id);

      // Fire and forget: the row is already gone from the user's view, and a
      // failed delete leaves a document nobody references rather than a broken
      // interface.
      await fetch(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => undefined);
    },
    [selected],
  );

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
        {/* Own scroll context, so switching reports never means scrolling past one. */}
        <aside className="sidebar">
          <button
            type="button"
            className="new-task"
            onClick={() => {
              setComposing(true);
              setSelected(null);
            }}
          >
            + New question
          </button>

          {tasks.length > 0 ? (
            <>
              <h2 className="sidebar-title">Your questions</h2>
              <ul className="task-list">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <div className="task-row">
                      <button
                        type="button"
                        className="task-item"
                        aria-current={t.id === selected}
                        onClick={() => {
                          setSelected(t.id);
                          setComposing(false);
                        }}
                      >
                        <q>{t.question}</q>
                        <span className="hint">
                          {new Date(t.at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {t.id === selected && live ? ' · running' : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="task-delete"
                        aria-label={`Delete: ${t.question}`}
                        title="Delete"
                        onClick={() => void remove(t.id)}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>

        <main>
          {!hydrated ? null : composing || !selected ? (
            <SubmitForm onCreated={onCreated} />
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
                    Restricted to {task.dateRange.start ?? 'any date'} →{' '}
                    {task.dateRange.end ?? 'today'}
                  </p>
                ) : null}

                {live ? (
                  <>
                    <Progress task={task} />
                    <p className="transport" style={{ marginTop: '0.6rem' }}>
                      {transport === 'stream' ? 'live updates' : 'polling for updates'}
                    </p>
                  </>
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

              {task.queries.length > 0 ? <SearchPanel task={task} /> : null}

              {/* The report as it is written, then the finished document. */}
              {streamingReport && revealed ? (
                <div style={{ marginTop: '2rem' }}>
                  <Report report={revealed} sources={task.sources} streaming />
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

              {task.queries.length > 0 ? (
                <CostPanel cost={task.cost} queries={task.queries} />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
