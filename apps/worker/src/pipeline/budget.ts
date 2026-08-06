import type { CostRecord } from '@deepresearch/shared';

/**
 * Per-task retrieval spend, measured rather than estimated.
 *
 * Valyu reports `total_deduction_dollars` and `tx_id` on every search response.
 * Both are recorded: the total is what the brief asks be stored, and the
 * transaction ids are the audit trail that makes the figure checkable against
 * Valyu's own billing rather than merely asserted.
 *
 * The gate is checked *before* dispatching each search, not after totalling.
 * Source pricing varies about eightfold — arXiv is roughly $0.001 per result
 * against patents at $0.008 — so a task that only reconciles afterwards can
 * overshoot the cap by an entire expensive call.
 */
export class BudgetLedger {
  private spent = 0;
  /**
   * Worst-case cost of calls that are in flight but have not reported yet.
   *
   * Without this the gate is useless under parallelism: five searches dispatched
   * together would all see a spend of zero and all be permitted, and the cap
   * would only be discovered after the money was gone.
   */
  private reserved = 0;
  private readonly txIds: string[] = [];
  private cappedAt: number | undefined;

  constructor(private readonly capUsd: number) {
    if (!(capUsd > 0)) {
      throw new Error(`budget cap must be greater than zero (got ${capUsd})`);
    }
  }

  /** Record measured spend from a completed search response. */
  charge(usd: number, txId?: string): void {
    if (Number.isFinite(usd) && usd > 0) this.spent += usd;
    if (txId) this.txIds.push(txId);
  }

  /**
   * Whether a search whose worst-case cost is `estimatedUsd` may be dispatched.
   *
   * Refusing is recorded, so the task can report that it stopped early because
   * of budget rather than because it ran out of things to search.
   */
  canAfford(estimatedUsd: number): boolean {
    // Float tolerance: 0.2 + 0.1 exceeds 0.3 in binary floating point, and a
    // call that lands exactly on the cap should be allowed.
    const affordable = this.spent + this.reserved + estimatedUsd <= this.capUsd + 1e-9;
    if (!affordable && this.cappedAt === undefined) this.cappedAt = this.spent;
    return affordable;
  }

  /**
   * Claim headroom for a call about to be dispatched. Returns false when the cap
   * would be breached, in which case the caller must not dispatch.
   */
  reserve(estimatedUsd: number): boolean {
    if (!this.canAfford(estimatedUsd)) return false;
    this.reserved += estimatedUsd;
    return true;
  }

  /** Release a reservation and record what the call actually cost. */
  settle(reservedUsd: number, actualUsd: number, txId?: string): void {
    this.reserved = Math.max(0, this.reserved - reservedUsd);
    this.charge(actualUsd, txId);
  }

  /** Headroom left, never negative even when a response overshot its estimate. */
  remaining(): number {
    return Math.max(0, this.capUsd - this.spent - this.reserved);
  }

  record(): CostRecord {
    const cost: CostRecord = {
      totalUsd: round(this.spent),
      txIds: [...this.txIds],
    };
    if (this.cappedAt !== undefined) cost.cappedAt = round(this.cappedAt);
    return cost;
  }
}

/** Six decimal places — Valyu bills in fractions of a cent. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
