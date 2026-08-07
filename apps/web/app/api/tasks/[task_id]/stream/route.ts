import { openTaskStream } from '@/lib/backend';

/**
 * Proxies the backend's event stream to the browser.
 *
 * The browser cannot open the upstream stream itself — that needs the API key,
 * which must stay server-side. So this handler holds the credential, opens the
 * connection, and pipes the bytes through untouched.
 *
 * The connection dies when the platform's function duration limit is reached,
 * well before a long task finishes. That is expected rather than a defect:
 * EventSource reconnects on its own, and because the backend replays current
 * state on subscribe, a reconnect resumes seamlessly instead of losing progress.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<Response> {
  const { task_id: taskId } = await params;

  let upstream: Response;
  try {
    upstream = await openTaskStream(taskId, request.signal);
  } catch {
    // The client falls back to polling, so a failure here degrades rather than breaks.
    return new Response('upstream unavailable', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response('upstream unavailable', { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells proxies not to buffer, which would defeat the point entirely.
      'X-Accel-Buffering': 'no',
    },
  });
}
