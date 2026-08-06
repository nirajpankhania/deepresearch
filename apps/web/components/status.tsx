import type { PipelineStage, Task, TaskStatus } from '@deepresearch/shared';

const LABELS: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Researching',
  completed: 'Complete',
  failed: 'Failed',
};

/**
 * Represents the four states honestly and distinctly. A failed task must never
 * read as merely "not finished yet" — that is the difference between a user
 * waiting pointlessly and a user resubmitting.
 */
export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}

/** The pipeline stages a user sees, in order. Internal stages are not surfaced. */
const STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'planning', label: 'Plan' },
  { key: 'retrieving', label: 'Search' },
  { key: 'deduplicating', label: 'Merge' },
  { key: 'reranking', label: 'Rank' },
  { key: 'synthesising', label: 'Write' },
];

export function Progress({ task }: { task: Task }) {
  const currentIndex = STAGES.findIndex((s) => s.key === task.progress.step);
  const done = task.status === 'completed';

  return (
    <div>
      <div className="bar">
        <i style={{ width: `${done ? 100 : task.progress.pct}%` }} />
      </div>

      <p className="hint" style={{ marginTop: '0.6rem' }} aria-live="polite">
        {task.progress.message}
      </p>

      <ol className="steps">
        {STAGES.map((stage, i) => {
          const state = done || (currentIndex > -1 && i < currentIndex)
            ? 'step-done'
            : i === currentIndex
              ? 'step-active'
              : '';
          return (
            <li key={stage.key} className={state}>
              {done || (currentIndex > -1 && i < currentIndex) ? '✓ ' : ''}
              {stage.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
