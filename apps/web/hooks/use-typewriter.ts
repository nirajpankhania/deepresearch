'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Reveals text character by character, catching up to whatever has arrived.
 *
 * The backend cannot stream per-token to the browser: tokens go from the worker
 * through Firestore to the API to the proxy, and publishing on every token would
 * mean a database write per token. So text arrives in small bursts, and this
 * smooths them into a continuous reveal.
 *
 * The rate is proportional to how far behind the display is, so a large burst is
 * consumed quickly while the tail of a burst slows to a natural per-character
 * pace. That keeps the reveal continuous whether chunks arrive every 250ms or
 * after a reconnect delivers several seconds at once — a fixed rate would either
 * stutter or fall progressively further behind.
 */

/** Larger divisor = more deliberate. 8 keeps up with ~250ms bursts comfortably. */
const CATCHUP_DIVISOR = 8;
/** Floor, so the tail of a burst still moves rather than crawling. */
const MIN_CHARS_PER_FRAME = 2;

export function useTypewriter(target: string, enabled: boolean): string {
  const [shown, setShown] = useState(0);
  const frame = useRef<number | null>(null);
  const length = useRef(0);

  length.current = target.length;

  useEffect(() => {
    if (!enabled) {
      // Snap to full text when the reveal is switched off, so finishing a task
      // never leaves a partially-typed report on screen.
      setShown(target.length);
      return;
    }

    // A shorter target means a different task, or a draft cleared on completion.
    setShown((current) => (current > target.length ? 0 : current));

    const tick = (): void => {
      setShown((current) => {
        const remaining = length.current - current;
        if (remaining <= 0) return current;
        return current + Math.max(MIN_CHARS_PER_FRAME, Math.ceil(remaining / CATCHUP_DIVISOR));
      });
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [enabled, target.length, target]);

  // Respect a reduced-motion preference by showing everything immediately.
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return enabled && !reduced ? target.slice(0, shown) : target;
}
