import { NextResponse } from 'next/server';

import { BackendError, createTask } from '@/lib/backend';

/** Never prerendered or cached — this proxies a mutation. */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const { question, dateRange } = (body ?? {}) as {
    question?: unknown;
    dateRange?: { start?: string; end?: string };
  };

  if (typeof question !== 'string' || question.trim() === '') {
    return NextResponse.json({ error: 'Please enter a research question.' }, { status: 400 });
  }

  try {
    // Validation proper lives in the backend, which is the only authority on it.
    // Duplicating the rules here would mean two places to keep in step.
    const created = await createTask({
      question: question.trim(),
      ...(dateRange && (dateRange.start || dateRange.end) ? { dateRange } : {}),
    });
    return NextResponse.json(created, { status: 202 });
  } catch (err: unknown) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Could not submit the question.' }, { status: 500 });
  }
}
