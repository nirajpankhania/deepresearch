import type { CompletionResult } from '@deepresearch/shared/firestore';
import type { Logger } from '@deepresearch/shared/logger';
import type { Progress, Task } from '@deepresearch/shared';

import { FORCE_FAILURE_SENTINEL } from '../config.js';

export interface PipelineContext {
  task: Task;
  log: Logger;
  /** Report progress and extend the lease. */
  onProgress: (progress: Progress) => Promise<void>;
  /** When true, the force-failure sentinel in a question is honoured. */
  faultInjectionEnabled: boolean;
}

/** Thrown by fault injection. Ordinary pipeline failures throw normal errors. */
export class InjectedFailure extends Error {
  constructor(attempt: number) {
    super(`Injected failure (attempt ${attempt})`);
    this.name = 'InjectedFailure';
  }
}

/**
 * PHASE 1 PLACEHOLDER.
 *
 * Returns a hardcoded report so the full lifecycle — enqueue, claim, lease,
 * transactional completion, retry, idempotent redelivery — can be proven on real
 * infrastructure before any model or retrieval call exists. When something
 * breaks in Phase 2, the infrastructure is already ruled out.
 *
 * Phases 2-5 replace the body with the real stages. The signature does not change.
 */
export async function runPipeline(ctx: PipelineContext): Promise<CompletionResult> {
  const { task, onProgress, faultInjectionEnabled } = ctx;

  if (faultInjectionEnabled && task.question.includes(FORCE_FAILURE_SENTINEL)) {
    ctx.log.warn('fault injection triggered', { attempt: task.attempt });
    throw new InjectedFailure(task.attempt);
  }

  await onProgress({ step: 'planning', message: 'Planning sub-queries', pct: 20 });
  await onProgress({ step: 'retrieving', message: 'Searching sources', pct: 50 });
  await onProgress({ step: 'synthesising', message: 'Writing report', pct: 80 });

  return {
    report: [
      `# Placeholder report`,
      ``,
      `**Question:** ${task.question}`,
      ``,
      `This is a hardcoded Phase 1 report. It exists to prove the task lifecycle`,
      `end to end on real infrastructure — Cloud Tasks dispatch, the Firestore`,
      `claim transaction, lease handling, and idempotent redelivery — before any`,
      `retrieval or model call is introduced.`,
      ``,
      `The retrieval pipeline replaces this in Phase 2.`,
    ].join('\n'),
    queries: [],
    sources: [],
    cost: { totalUsd: 0, txIds: [] },
  };
}
