import { isTerminal, type TaskStatus } from '@deepresearch/shared';

/**
 * Phase 0 shell for the frontend.
 *
 * Deployed ahead of the real UI to prove one specific thing: that Vercel, with
 * Root Directory set to `apps/web`, resolves and builds the `@deepresearch/shared`
 * workspace dependency. `isTerminal` below is a runtime import rather than a
 * type — a type-only import would be erased at compile time and would prove
 * nothing about module resolution.
 *
 * The submission form, polling and report rendering land in Phase 4.
 */

const STAGES: { status: TaskStatus; label: string }[] = [
  { status: 'queued', label: 'Queued' },
  { status: 'running', label: 'Researching' },
  { status: 'completed', label: 'Report ready' },
  { status: 'failed', label: 'Failed' },
];

export default function Home() {
  return (
    <main
      style={{
        maxWidth: '46rem',
        margin: '0 auto',
        padding: '5rem 1.5rem',
      }}
    >
      <p
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          fontSize: '0.75rem',
          color: 'var(--muted)',
          margin: 0,
        }}
      >
        Scientific literature
      </p>
      <h1 style={{ fontSize: '2.5rem', lineHeight: 1.15, margin: '0.5rem 0 0' }}>DeepResearch</h1>
      <p style={{ color: 'var(--muted)', fontSize: '1.05rem', marginTop: '0.75rem' }}>
        Asks a research question across papers, clinical trials and patents, then returns a cited
        report you can check.
      </p>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '2.5rem 0' }} />

      <h2 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>
        Task lifecycle
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0' }}>
        {STAGES.map((s) => (
          <li
            key={s.status}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.75rem',
              padding: '0.6rem 0',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <code style={{ color: 'var(--accent)', fontSize: '0.85rem', minWidth: '6.5rem' }}>
              {s.status}
            </code>
            <span>{s.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--muted)' }}>
              {isTerminal(s.status) ? 'terminal' : 'in progress'}
            </span>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: '2.5rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
        The backend is deployed and the task lifecycle is working. The interface for submitting
        questions and reading reports is in progress.
      </p>
    </main>
  );
}
