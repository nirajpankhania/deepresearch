import { describe, expect, it } from 'vitest';

import { BudgetLedger } from './budget.js';

describe('BudgetLedger', () => {
  it('starts empty', () => {
    const b = new BudgetLedger(0.3);
    expect(b.record()).toEqual({ totalUsd: 0, txIds: [] });
  });

  it('accumulates measured cost and transaction ids', () => {
    const b = new BudgetLedger(0.3);
    b.charge(0.006, 'tx_a');
    b.charge(0.024, 'tx_b');
    const r = b.record();
    expect(r.totalUsd).toBeCloseTo(0.03, 6);
    expect(r.txIds).toEqual(['tx_a', 'tx_b']);
  });

  it('records a response that reported no transaction id', () => {
    const b = new BudgetLedger(0.3);
    b.charge(0.005, undefined);
    expect(b.record()).toMatchObject({ totalUsd: 0.005, txIds: [] });
  });

  describe('the gate', () => {
    // Checked BEFORE dispatch, not after. Patents cost roughly eight times what
    // arXiv does, so a task that only checks afterwards can overshoot the cap by
    // a whole expensive call.
    it('permits a call while headroom remains', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.1, 'tx_a');
      expect(b.canAfford(0.1)).toBe(true);
    });

    it('refuses a call whose worst-case cost would exceed the cap', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.25, 'tx_a');
      expect(b.canAfford(0.1)).toBe(false);
    });

    it('permits a call that lands exactly on the cap', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.2, 'tx_a');
      expect(b.canAfford(0.1)).toBe(true);
    });

    it('refuses everything once the cap is reached', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.3, 'tx_a');
      expect(b.canAfford(0.0001)).toBe(false);
    });

    it('reports remaining headroom', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.1, 'tx_a');
      expect(b.remaining()).toBeCloseTo(0.2, 6);
    });

    it('never reports negative headroom after an overshoot', () => {
      // A single response can cost more than estimated; the ledger records the
      // truth but must not report a negative allowance.
      const b = new BudgetLedger(0.3);
      b.charge(0.4, 'tx_a');
      expect(b.remaining()).toBe(0);
      expect(b.record().totalUsd).toBeCloseTo(0.4, 6);
    });
  });

  describe('capping', () => {
    it('does not mark the record capped when nothing was refused', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.01, 'tx_a');
      expect(b.record().cappedAt).toBeUndefined();
    });

    it('marks the record capped at the spend where a call was refused', () => {
      const b = new BudgetLedger(0.3);
      b.charge(0.28, 'tx_a');
      expect(b.canAfford(0.1)).toBe(false);
      expect(b.record().cappedAt).toBeCloseTo(0.28, 6);
    });
  });

  describe('reservations', () => {
    // Without reservations the gate is useless under parallelism: searches
    // dispatched together all observe a spend of zero and are all permitted.
    it('refuses a reservation once concurrent in-flight calls would breach the cap', () => {
      const b = new BudgetLedger(0.3);
      expect(b.reserve(0.15)).toBe(true);
      expect(b.reserve(0.15)).toBe(true);
      expect(b.reserve(0.15)).toBe(false);
    });

    it('counts reservations against remaining headroom', () => {
      const b = new BudgetLedger(0.3);
      b.reserve(0.1);
      expect(b.remaining()).toBeCloseTo(0.2, 6);
    });

    it('frees headroom when a call settles for less than reserved', () => {
      const b = new BudgetLedger(0.3);
      b.reserve(0.2);
      expect(b.reserve(0.2)).toBe(false);

      b.settle(0.2, 0.02, 'tx_a');
      expect(b.reserve(0.2)).toBe(true);
      expect(b.record()).toMatchObject({ totalUsd: 0.02, txIds: ['tx_a'] });
    });

    it('records the true cost when a call overshoots its reservation', () => {
      const b = new BudgetLedger(0.3);
      b.reserve(0.05);
      b.settle(0.05, 0.09, 'tx_a');
      expect(b.record().totalUsd).toBeCloseTo(0.09, 6);
      expect(b.remaining()).toBeCloseTo(0.21, 6);
    });

    it('marks the record capped when a reservation is refused', () => {
      const b = new BudgetLedger(0.3);
      b.reserve(0.28);
      expect(b.reserve(0.1)).toBe(false);
      expect(b.record().cappedAt).toBeDefined();
    });
  });

  it('rejects a nonsensical cap rather than silently allowing unbounded spend', () => {
    expect(() => new BudgetLedger(0)).toThrow();
    expect(() => new BudgetLedger(-1)).toThrow();
  });
});
