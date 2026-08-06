import { describe, expect, it, vi } from 'vitest';

import { TimeoutError, callWithRetry, isRetryable, statusOf } from './resilience.js';

const noSleep = async (): Promise<void> => {};

describe('isRetryable', () => {
  // The rule that keeps a failing task from spending money to get the same
  // rejection three times.
  it.each([500, 502, 503, 504, 429])('retries %i', (status) => {
    expect(isRetryable({ status })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('does not retry %i', (status) => {
    expect(isRetryable({ status })).toBe(false);
  });

  it('retries a transport error with no status', () => {
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
  });

  it('retries a timeout', () => {
    expect(isRetryable(new TimeoutError(100))).toBe(true);
  });
});

describe('statusOf', () => {
  it.each([
    [{ status: 503 }, 503],
    [{ statusCode: 502 }, 502],
    [{ response: { status: 500 } }, 500],
  ])('reads a status from %o', (err, expected) => {
    expect(statusOf(err)).toBe(expected);
  });

  it('ignores a gRPC-style code that is not an HTTP status', () => {
    expect(statusOf({ code: 6 })).toBeUndefined();
  });

  it('returns undefined for a plain error', () => {
    expect(statusOf(new Error('boom'))).toBeUndefined();
  });
});

describe('callWithRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await callWithRetry(fn, { attempts: 3, timeoutMs: 100, sleep: noSleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('recovered');
    const out = await callWithRetry(fn, { attempts: 3, timeoutMs: 100, sleep: noSleep });
    expect(out).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(
      callWithRetry(fn, { attempts: 3, timeoutMs: 100, sleep: noSleep }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt limit and rethrows', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(
      callWithRetry(fn, { attempts: 3, timeoutMs: 100, sleep: noSleep }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially between attempts', async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(
      callWithRetry(fn, {
        attempts: 4,
        timeoutMs: 100,
        baseDelayMs: 10,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toBeDefined();
    expect(delays).toEqual([10, 20, 40]);
  });

  it('times out a call that hangs, and reports it as retryable', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(
      callWithRetry(fn, { attempts: 2, timeoutMs: 20, sleep: noSleep }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
