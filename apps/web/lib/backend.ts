import 'server-only';

import type { CreateTaskRequest, CreateTaskResponse, Task } from '@deepresearch/shared';

/**
 * Server-side client for the Cloud Run API.
 *
 * The `server-only` import at the top is load-bearing: it makes the build fail
 * if this module is ever reached from a client component, rather than shipping
 * `BACKEND_API_KEY` into a browser bundle and finding out later.
 *
 * The browser never talks to Cloud Run. It calls this app's route handlers,
 * which call the backend with the shared key. That keeps the credential on the
 * server, and means the backend's CORS allowlist only has to admit the Vercel
 * deployment rather than every visitor's origin.
 */

function config(): { url: string; key: string } {
  const url = process.env['BACKEND_API_URL'];
  const key = process.env['BACKEND_API_KEY'];

  if (!url || !key) {
    throw new Error(
      'BACKEND_API_URL and BACKEND_API_KEY must be set. Configure them as server-side environment variables in Vercel, separately for Preview and Production.',
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = config();

  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key, ...init?.headers },
      // Task state changes constantly; a cached poll would be worse than useless.
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: unknown) {
    throw new BackendError(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'The research service did not respond in time.'
        : 'Could not reach the research service.',
      502,
    );
  }

  if (!response.ok) {
    // The backend's error messages are written for humans, so pass them through
    // where there is one. Never surface the status text alone; it says nothing.
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new BackendError(
      body?.error ?? 'The research service returned an unexpected error.',
      response.status,
    );
  }

  return (await response.json()) as T;
}

export function createTask(body: CreateTaskRequest): Promise<CreateTaskResponse> {
  return request<CreateTaskResponse>('/tasks', { method: 'POST', body: JSON.stringify(body) });
}

export function getTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`);
}

/**
 * Opens the upstream event stream, for the route handler to pipe to the browser.
 *
 * No timeout here, unlike every other call: the whole point is a connection held
 * open for the life of the task. It is bounded instead by the caller's abort
 * signal and by the platform's function duration limit.
 */
export async function openTaskStream(taskId: string, signal: AbortSignal): Promise<Response> {
  const { url, key } = config();

  return fetch(`${url}/tasks/${encodeURIComponent(taskId)}/stream`, {
    headers: { Accept: 'text/event-stream', 'X-API-Key': key },
    cache: 'no-store',
    signal,
  });
}
