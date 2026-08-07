import { NextResponse } from 'next/server';

import { BackendError, deleteTask, getTask } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const { task_id: taskId } = await params;

  try {
    return NextResponse.json(await getTask(taskId));
  } catch (err: unknown) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Could not load this task.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<NextResponse> {
  const { task_id: taskId } = await params;

  try {
    await deleteTask(taskId);
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    if (err instanceof BackendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Could not delete this task.' }, { status: 500 });
  }
}
