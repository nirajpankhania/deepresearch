import { describe, expect, it } from 'vitest';

import { isOrphaned, isTerminal } from './types.js';

const NOW = Date.parse('2026-08-06T12:00:00Z');
const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();
const GRACE = 3600;

describe('isTerminal', () => {
  it.each([
    ['completed', true],
    ['failed', true],
    ['queued', false],
    ['running', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(isTerminal(status)).toBe(expected);
  });
});

describe('isOrphaned', () => {
  it('reaps a running task whose lease lapsed long ago', () => {
    expect(isOrphaned({ status: 'running', leaseExpiresAt: ago(GRACE + 60) }, GRACE, NOW)).toBe(
      true,
    );
  });

  // Reaping too eagerly is the worse error: a terminal state would make a
  // legitimate in-flight retry no-op, turning a recoverable task into a dead one.
  it('does not reap a lease that lapsed within the grace period', () => {
    expect(isOrphaned({ status: 'running', leaseExpiresAt: ago(GRACE - 60) }, GRACE, NOW)).toBe(
      false,
    );
  });

  it('does not reap a live lease', () => {
    const future = new Date(NOW + 600_000).toISOString();
    expect(isOrphaned({ status: 'running', leaseExpiresAt: future }, GRACE, NOW)).toBe(false);
  });

  it('does not reap exactly at the grace boundary', () => {
    expect(isOrphaned({ status: 'running', leaseExpiresAt: ago(GRACE) }, GRACE, NOW)).toBe(false);
  });

  it.each(['queued', 'completed', 'failed'] as const)('never reaps a %s task', (status) => {
    expect(isOrphaned({ status, leaseExpiresAt: ago(GRACE + 6000) }, GRACE, NOW)).toBe(false);
  });

  it('does not reap a running task holding no lease', () => {
    // Transiently possible between claim and lease write; not evidence of death.
    expect(isOrphaned({ status: 'running', leaseExpiresAt: null }, GRACE, NOW)).toBe(false);
  });

  it('does not reap on an unparseable lease timestamp', () => {
    expect(isOrphaned({ status: 'running', leaseExpiresAt: 'not a date' }, GRACE, NOW)).toBe(false);
  });
});
