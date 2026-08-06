'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminal, type Task } from '@deepresearch/shared';

/**
 * Polls a task until it reaches a terminal state.
 *
 * Polling rather than SSE. A research task runs for a minute or two, so an open
 * connection buys little: it would have to survive a Vercel function timeout and
 * a dropped connection would need reconnection logic anyway. Polling degrades
 * gracefully — a failed poll is retried on the next tick and the user sees
 * nothing — and costs one small request every couple of seconds.
 *
 * The interval widens after the first minute because a task still running then
 * is usually in synthesis, which takes tens of seconds and produces no
 * intermediate progress worth the extra requests.
 */

const FAST_INTERVAL_MS = 2000;
const SLOW_INTERVAL_MS = 5000;
const SLOW_AFTER_MS = 60_000;

export interface TaskState {
  task: Task | null;
  /** Set only when the task itself could not be loaded, not when it failed. */
  loadError: string | null;
  isPolling: boolean;
}

export function useTask(taskId: string | null): TaskState {
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const startedAt = useRef<number>(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive failures, so a blip does not surface as an error to the user.
  const failures = useRef(0);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    setTask(null);
    setLoadError(null);
    failures.current = 0;
    startedAt.current = Date.now();

    if (!taskId) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    setIsPolling(true);

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Could not load this task.');
        }

        const next = (await response.json()) as Task;
        if (cancelled) return;

        failures.current = 0;
        setTask(next);
        setLoadError(null);

        if (isTerminal(next.status)) {
          setIsPolling(false);
          return;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        failures.current += 1;

        // Two consecutive failures before saying anything: a single dropped
        // request is normal and showing an error for it would be noise.
        if (failures.current >= 2) {
          setLoadError(err instanceof Error ? err.message : 'Could not load this task.');
        }
      }

      if (cancelled) return;
      const elapsed = Date.now() - startedAt.current;
      timer.current = setTimeout(
        () => void poll(),
        elapsed > SLOW_AFTER_MS ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS,
      );
    };

    void poll();

    return () => {
      cancelled = true;
      clear();
    };
  }, [taskId, clear]);

  return { task, loadError, isPolling };
}
