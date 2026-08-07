/**
 * Model list prices, in dollars per million tokens.
 *
 * ⚠️ These are **published list prices**, not measured spend. Retrieval cost
 * comes from Valyu's own response and is exact; model cost is derived from token
 * counts the API reports against the table below, so it moves whenever Google
 * reprices and nothing here will notice. The UI labels it "estimated" for that
 * reason, and the two are kept in separate fields so they are never added
 * together as if equally trustworthy.
 *
 * Reasoning tokens bill at the output rate. That is the single most surprising
 * line in the bill, because they never appear in the response.
 */

export interface Rate {
  inputPerMillion: number;
  outputPerMillion: number;
}

const RATES: Record<string, Rate> = {
  'gemini-3-flash-preview': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
};

/** Falls back to the Pro rate, so an unknown model over-reports rather than under. */
const FALLBACK: Rate = { inputPerMillion: 1.25, outputPerMillion: 10.0 };

export function rateFor(model: string): Rate {
  return RATES[model] ?? FALLBACK;
}

/**
 * Price a single call. `thoughtTokens` are charged at the output rate — they are
 * generated tokens, they are simply not shown to the caller.
 */
export function priceCall(
  model: string,
  promptTokens: number,
  outputTokens: number,
  thoughtTokens: number,
): number {
  const rate = rateFor(model);
  const input = (promptTokens / 1_000_000) * rate.inputPerMillion;
  const output = ((outputTokens + thoughtTokens) / 1_000_000) * rate.outputPerMillion;
  return Math.round((input + output) * 1e6) / 1e6;
}
