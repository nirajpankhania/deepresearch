import { GoogleGenAI } from '@google/genai';
import type { Logger } from '@deepresearch/shared/logger';

import type { ModelCall } from '@deepresearch/shared';

import { priceCall } from './pricing.js';
import { callWithRetry } from './resilience.js';

/**
 * Vertex AI Gemini.
 *
 * Authenticates via the worker's service account — there is no model API key
 * anywhere in the system, which is the single biggest reduction in the secret
 * inventory. Uses the global endpoint rather than a regional one for capacity.
 *
 * Two tiers: Flash for the many cheap calls (planning, reranking, grounding) and
 * Pro for the one call whose quality is directly visible, synthesis.
 *
 * The call counter is a hard per-task step limit. It exists because a bug in an
 * orchestration loop is otherwise indistinguishable from ordinary operation
 * until the bill arrives.
 */

export type ModelTier = 'flash' | 'pro';

export class ModelCallLimitError extends Error {
  constructor(limit: number) {
    super(`per-task model call limit of ${limit} reached`);
    this.name = 'ModelCallLimitError';
  }
}

export interface GeminiOptions {
  projectId: string;
  flashModel: string;
  proModel: string;
  maxCalls: number;
  log: Logger;
}

export interface GenerateParams {
  tier: ModelTier;
  /** Which pipeline stage this call belongs to, for the cost breakdown. */
  stage: ModelCall['stage'];
  prompt: string;
  /**
   * Bounds the response, and with it the cost of a runaway generation.
   *
   * ⚠️ On the Gemini 3 line this budget covers *reasoning tokens as well as
   * output*. A long prompt drives reasoning up, and the visible answer is
   * truncated to fit whatever is left — which for a JSON response means
   * unparseable output rather than a short one. Budget generously and cap
   * reasoning explicitly via `thinkingBudget`.
   */
  maxOutputTokens: number;
  /** Hard ceiling on reasoning tokens, so the answer always has room. */
  thinkingBudget?: number;
  temperature?: number;
  /** When set, the model is constrained to emit JSON matching this schema. */
  responseSchema?: Record<string, unknown>;
  /** Overrides the default per-call timeout. Larger prompts need longer. */
  timeoutMs?: number;
}

const TIMEOUT_MS = 60_000;
const ATTEMPTS = 3;

export class GeminiClient {
  private readonly ai: GoogleGenAI;
  private calls = 0;
  private readonly usage: ModelCall[] = [];

  constructor(private readonly opts: GeminiOptions) {
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: opts.projectId,
      location: 'global',
    });
  }

  /** Model calls consumed so far, for the trace and for progress reporting. */
  get callCount(): number {
    return this.calls;
  }

  /** Per-call token usage and estimated cost, for the task's cost breakdown. */
  get modelUsage(): { estimatedUsd: number; calls: ModelCall[] } {
    const estimatedUsd = this.usage.reduce((sum, c) => sum + c.estimatedUsd, 0);
    return { estimatedUsd: Math.round(estimatedUsd * 1e6) / 1e6, calls: [...this.usage] };
  }

  private modelFor(tier: ModelTier): string {
    return tier === 'pro' ? this.opts.proModel : this.opts.flashModel;
  }

  async generate(params: GenerateParams): Promise<string> {
    if (this.calls >= this.opts.maxCalls) {
      throw new ModelCallLimitError(this.opts.maxCalls);
    }
    this.calls += 1;

    const model = this.modelFor(params.tier);
    const started = Date.now();

    const response = await callWithRetry(
      async () =>
        this.ai.models.generateContent({
          model,
          contents: params.prompt,
          config: {
            maxOutputTokens: params.maxOutputTokens,
            temperature: params.temperature ?? 0.2,
            ...(params.thinkingBudget !== undefined
              ? { thinkingConfig: { thinkingBudget: params.thinkingBudget } }
              : {}),
            ...(params.responseSchema
              ? {
                  responseMimeType: 'application/json',
                  responseSchema: params.responseSchema,
                }
              : {}),
          },
        }),
      {
        attempts: ATTEMPTS,
        timeoutMs: params.timeoutMs ?? TIMEOUT_MS,
        onRetry: ({ attempt, reason }) =>
          this.opts.log.warn('gemini retry', { attempt, reason, model, tier: params.tier }),
      },
    );

    const text = response.text ?? '';
    const durationMs = Date.now() - started;

    // Token counts come from the API rather than being derived from characters,
    // which is what makes the cost breakdown worth showing at all.
    const usage = response.usageMetadata;
    const promptTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const thoughtTokens = usage?.thoughtsTokenCount ?? 0;

    const record: ModelCall = {
      stage: params.stage,
      tier: params.tier,
      model,
      promptTokens,
      outputTokens,
      thoughtTokens,
      estimatedUsd: priceCall(model, promptTokens, outputTokens, thoughtTokens),
      durationMs,
    };
    this.usage.push(record);

    this.opts.log.info('gemini call complete', {
      model,
      tier: params.tier,
      stage: params.stage,
      call: this.calls,
      promptTokens,
      outputTokens,
      thoughtTokens,
      estimatedUsd: record.estimatedUsd,
      durationMs,
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      // Distinguished from other failures because the fix is a bigger budget,
      // not a retry — retrying truncates in exactly the same place.
      throw new Error(
        `model ${model} hit the output token limit (${params.maxOutputTokens}); response was truncated`,
      );
    }

    if (text.trim() === '') {
      // An empty completion usually means the response hit a safety filter or
      // the token limit. Either way it is not something a retry fixes.
      throw new Error(`model ${model} returned an empty response`);
    }

    return text;
  }

  /**
   * Generate, delivering text as it arrives.
   *
   * Used only for synthesis, the one call long enough that watching it write is
   * meaningfully better than waiting forty seconds for it to appear.
   *
   * Deliberately not retried. A retry would restart generation from nothing
   * after the reader has already seen half a report, and the resulting jump
   * backwards is worse than the failure. The stage is non-fatal to the pipeline
   * in the same way the rest are — the caller decides.
   */
  async generateStream(
    params: GenerateParams,
    onText: (accumulated: string) => void | Promise<void>,
  ): Promise<string> {
    if (this.calls >= this.opts.maxCalls) {
      throw new ModelCallLimitError(this.opts.maxCalls);
    }
    this.calls += 1;

    const model = this.modelFor(params.tier);
    const started = Date.now();

    const stream = await this.ai.models.generateContentStream({
      model,
      contents: params.prompt,
      config: {
        maxOutputTokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0.2,
        ...(params.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: params.thinkingBudget } }
          : {}),
      },
    });

    let accumulated = '';
    let promptTokens = 0;
    let outputTokens = 0;
    let thoughtTokens = 0;

    for await (const chunk of stream) {
      const text = chunk.text ?? '';
      if (text !== '') {
        accumulated += text;
        await onText(accumulated);
      }
      // Usage arrives on the final chunks; keep the latest non-zero figures.
      const usage = chunk.usageMetadata;
      if (usage) {
        promptTokens = usage.promptTokenCount ?? promptTokens;
        outputTokens = usage.candidatesTokenCount ?? outputTokens;
        thoughtTokens = usage.thoughtsTokenCount ?? thoughtTokens;
      }
    }

    const durationMs = Date.now() - started;
    const record: ModelCall = {
      stage: params.stage,
      tier: params.tier,
      model,
      promptTokens,
      outputTokens,
      thoughtTokens,
      estimatedUsd: priceCall(model, promptTokens, outputTokens, thoughtTokens),
      durationMs,
    };
    this.usage.push(record);

    this.opts.log.info('gemini stream complete', {
      model,
      tier: params.tier,
      stage: params.stage,
      promptTokens,
      outputTokens,
      thoughtTokens,
      estimatedUsd: record.estimatedUsd,
      durationMs,
    });

    if (accumulated.trim() === '') {
      throw new Error(`model ${model} streamed an empty response`);
    }

    return accumulated;
  }

  /**
   * Generate and parse JSON.
   *
   * A schema is passed to constrain generation, but the result is still parsed
   * defensively: structured output makes malformed JSON rare, not impossible,
   * and a task should fail with a clear message rather than a stack trace from
   * deep inside a parser.
   */
  async generateJson<T>(params: GenerateParams & { responseSchema: Record<string, unknown> }): Promise<T> {
    const raw = await this.generate(params);

    // Models occasionally wrap JSON in a fenced code block despite the schema.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new Error(
        `model ${this.modelFor(params.tier)} returned unparseable JSON (${cleaned.slice(0, 120)}…)`,
      );
    }
  }
}
