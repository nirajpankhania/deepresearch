'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminal, type Task } from '@deepresearch/shared';

/**
 * Follows a task to completion, by event stream where possible and by polling
 * where not.
 *
 * SSE is the primary path: the backend watches Firestore and pushes every
 * change, so sub-queries appear as they are planned and the report arrives as it
 * is written rather than in two-second jumps.
 *
 * Polling is a real fallback, not dead code. The proxying function has a
 * duration limit shorter than a long task, corporate proxies sometimes strip
 * event streams, and the connection can simply drop. Repeated stream failures
 * fall back to polling permanently for that task, so a degraded network costs
 * smoothness rather than the feature.
 */

const FAST_INTERVAL_MS = 2000;
const SLOW_INTERVAL_MS = 5000;
const SLOW_AFTER_MS = 60_000;

/** Consecutive stream failures before abandoning SSE for this task. */
const MAX_STREAM_FAILURES = 3;

export type Transport = 'stream' | 'poll' | 'idle';

export interface TaskState {
  task: Task | null;
  /** Set only when the task could not be loaded, never when the task itself failed. */
  loadError: string | null;
  isFollowing: boolean;
  transport: Transport;
}

export function useTask(taskId: string | null): TaskState {
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [transport, setTransport] = useState<Transport>('idle');

  const startedAt = useRef(Date.now());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useRef<EventSource | null>(null);
  const streamFailures = useRef(0);
  const pollFailures = useRef(0);

  const apply = useCallback((next: Task): boolean => {
    setTask(next);
    setLoadError(null);
    return isTerminal(next.status);
  }, []);

  useEffect(() => {
    setTask(null);
    setLoadError(null);
    streamFailures.current = 0;
    pollFailures.current = 0;
    startedAt.current = Date.now();

    if (!taskId) {
      setIsFollowing(false);
      setTransport('idle');
      return;
    }

    let cancelled = false;
    setIsFollowing(true);

    const stop = (): void => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollTimer.current = null;
      source.current?.close();
      source.current = null;
    };

    // --- polling fallback ---------------------------------------------------
    const poll = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Could not load this task.');
        }
        const next = (await response.json()) as Task;
        if (cancelled) return;

        pollFailures.current = 0;
        if (apply(next)) {
          setIsFollowing(false);
          return;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        pollFailures.current += 1;
        // One dropped request is normal; saying so immediately would be noise.
        if (pollFailures.current >= 2) {
          setLoadError(err instanceof Error ? err.message : 'Could not load this task.');
        }
      }

      if (cancelled) return;
      const elapsed = Date.now() - startedAt.current;
      pollTimer.current = setTimeout(
        () => void poll(),
        elapsed > SLOW_AFTER_MS ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS,
      );
    };

    const startPolling = (): void => {
      if (cancelled) return;
      setTransport('poll');
      void poll();
    };

    // --- event stream -------------------------------------------------------
    const startStream = (): void => {
      if (cancelled) return;

      // EventSource is same-origin here: it hits this app's route handler, which
      // holds the credential and proxies upstream.
      const es = new EventSource(`/api/tasks/${taskId}/stream`);
      source.current = es;
      setTransport('stream');

      es.addEventListener('task', (event) => {
        if (cancelled) return;
        try {
          const next = JSON.parse((event as MessageEvent<string>).data) as Task;
          streamFailures.current = 0;
          if (apply(next)) {
            setIsFollowing(false);
            stop();
          }
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      });

      // While only the draft grows, the server sends the appended characters
      // rather than the whole task. Resending everything made each frame ~133KB,
      // most of it source text nothing renders, and arrive in visible lumps.
      es.addEventListener('draft', (event) => {
        if (cancelled) return;
        try {
          const { append } = JSON.parse((event as MessageEvent<string>).data) as {
            append?: string;
          };
          if (!append) return;
          streamFailures.current = 0;
          setTask((current) =>
            current ? { ...current, reportDraft: (current.reportDraft ?? '') + append } : current,
          );
        } catch {
          // Ignore; the next full frame resynchronises.
        }
      });

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        source.current = null;
        streamFailures.current += 1;

        // The proxy's duration limit closes the connection mid-task, so a
        // reconnect is the expected case rather than an error. Only repeated
        // failures mean the stream is genuinely unavailable.
        if (streamFailures.current >= MAX_STREAM_FAILURES) {
          startPolling();
          return;
        }
        setTimeout(() => startStream(), 1000);
      };
    };

    if (typeof EventSource === 'undefined') startPolling();
    else startStream();

    return () => {
      cancelled = true;
      stop();
    };
  }, [taskId, apply]);

  return { task, loadError, isFollowing, transport };
}
