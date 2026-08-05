import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Shared-token auth for the public API.
 *
 * The token is held server-side by the Next.js route handler and never reaches
 * the browser. It exists because an endpoint backed by paid search and model
 * calls is a cost-exposure problem: the research results are not confidential,
 * but the ability to spend against the Valyu key is.
 */
export function requireApiKey(expected: string): MiddlewareHandler {
  const expectedBuf = Buffer.from(expected, 'utf8');

  return async (c, next) => {
    const presented = c.req.header('x-api-key') ?? '';
    const presentedBuf = Buffer.from(presented, 'utf8');

    // timingSafeEqual throws on length mismatch, so length is checked first.
    // Comparing lengths is not itself a meaningful leak: the token length is
    // fixed and public knowledge.
    const ok =
      presentedBuf.length === expectedBuf.length && timingSafeEqual(presentedBuf, expectedBuf);

    if (!ok) {
      // No detail about what was wrong — a caller without the key learns nothing.
      return c.json({ error: 'unauthorized' }, 401);
    }

    await next();
  };
}
