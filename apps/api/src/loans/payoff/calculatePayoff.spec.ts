import { addDays, subDays } from 'date-fns';

import {
  ConceptCalculationType,
  ConceptCategory,
} from '../../interestConceptTypes/entities/interestConceptType.entity';

import { calculatePayoff } from './calculatePayoff';

import type { PayoffInstallmentInput } from './calculatePayoff';

// `today` below is always anchored at T12:00:00Z (noon UTC = 7am Bogotá)
// rather than bare midnight — matching real usage (`today` is always
// `new Date()`, "right now", essentially never exact UTC midnight) and
// keeping every "today is day X" fixture safely inside Bogotá's calendar
// day X. Bug fix, 2026-09-04 (see installmentCalculations.ts and
// docs/DATABASE.md's note of that date): calculateOverdueDays/
// calculateDaysUntilDue now compute Bogotá calendar days, and a bare
// midnight `today` is 7pm the evening before in Bogotá — every test here
// would be off by exactly one day without this anchor.

function installment(
  overrides: Partial<PayoffInstallmentInput> = {},
): PayoffInstallmentInput {
  return {
    installmentId: 'inst-1',
    installmentNumber: 1,
    amount: 300000,
    principalPortion: 270000,
    dueDate: '2026-01-01',
    moratoryConcepts: [],
    ...overrides,
  };
}

describe('calculatePayoff', () => {
  it('applies concept charges and moratory interest for a single overdue installment', () => {
    const today = new Date('2026-01-11T12:00:00Z');
    const dueDate = subDays(today, 10).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [installment({ dueDate, amount: 300000, principalPortion: 270000 })],
      6,
      today,
    );

    // conceptsInterest = 300000 - 270000 = 30000
    // moratoryInterest = 300000 * 0.06 / 30 * 10 = 6000
    expect(quote.installments[0]).toMatchObject({
      interestApplied: 36000,
      principalApplied: 270000,
      totalDue: 306000,
    });
    expect(quote.totalInterestOwed).toBeCloseTo(36000, 6);
    expect(quote.totalPrincipalOwed).toBe(270000);
    expect(quote.totalDue).toBeCloseTo(306000, 6);
  });

  it('sums interest and principal across multiple overdue installments', () => {
    const today = new Date('2026-02-01T12:00:00Z');
    const overdueDate = subDays(today, 5).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          installmentId: 'inst-1',
          installmentNumber: 1,
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
        }),
        installment({
          installmentId: 'inst-2',
          installmentNumber: 2,
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
        }),
      ],
      6,
      today,
    );

    expect(quote.installments).toHaveLength(2);
    expect(quote.totalPrincipalOwed).toBe(540000);
    // Each installment: conceptsInterest 30000 + moratory (300000*0.06/30*5=3000) = 33000
    expect(quote.totalInterestOwed).toBeCloseTo(66000, 6);
    expect(quote.totalDue).toBeCloseTo(606000, 6);
  });

  it('charges a not-yet-due installment only its principal, at face value, with zero interest', () => {
    const today = new Date('2026-01-01T12:00:00Z');
    const futureDate = addDays(today, 20).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          dueDate: futureDate,
          amount: 300000,
          principalPortion: 270000,
        }),
      ],
      6,
      today,
    );

    expect(quote.installments[0]).toEqual({
      installmentId: 'inst-1',
      installmentNumber: 1,
      interestApplied: 0,
      principalApplied: 270000,
      totalDue: 270000,
      conceptBreakdown: [],
    });
  });

  it('mixes an overdue and a future installment correctly in the same quote', () => {
    const today = new Date('2026-03-01T12:00:00Z');
    const overdueDate = subDays(today, 15).toISOString().slice(0, 10);
    const futureDate = addDays(today, 15).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          installmentId: 'inst-overdue',
          installmentNumber: 1,
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
        }),
        installment({
          installmentId: 'inst-future',
          installmentNumber: 2,
          dueDate: futureDate,
          amount: 300000,
          principalPortion: 270000,
        }),
      ],
      6,
      today,
    );

    const overdue = quote.installments.find(
      (i) => i.installmentId === 'inst-overdue',
    );
    const future = quote.installments.find(
      (i) => i.installmentId === 'inst-future',
    );

    expect(overdue?.interestApplied).toBeGreaterThan(0);
    expect(future?.interestApplied).toBe(0);
    expect(future?.totalDue).toBe(270000);
    expect(quote.totalPrincipalOwed).toBe(540000);
  });

  it('charges an installment due exactly today its concept interest but zero moratory interest', () => {
    const today = new Date('2026-01-01T12:00:00Z');

    const quote = calculatePayoff(
      [
        installment({
          dueDate: '2026-01-01',
          amount: 300000,
          principalPortion: 270000,
        }),
      ],
      6,
      today,
    );

    // Matured (due today), so concepts interest (30000) applies, but
    // overdueDays is 0 so moratory interest is 0.
    expect(quote.installments[0].interestApplied).toBeCloseTo(30000, 6);
  });

  it('falls back to treating the whole amount as principal when principalPortion is null (pre-Phase-14 installments)', () => {
    const today = new Date('2026-01-11T12:00:00Z');
    const overdueDate = subDays(today, 10).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: null,
        }),
      ],
      6,
      today,
    );

    // No concept charges possible without a principal/concept split, so
    // interestApplied is purely the moratory formula: 300000*0.06/30*10.
    expect(quote.installments[0].interestApplied).toBeCloseTo(6000, 6);
    expect(quote.installments[0].principalApplied).toBe(300000);
  });

  it('uses the installment-assigned moratory concepts instead of the legacy interestRate formula once at least one is present', () => {
    const today = new Date('2026-01-11T12:00:00Z');
    const dueDate = subDays(today, 10).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          dueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [
            {
              name: 'Interés moratorio',
              calculationType: ConceptCalculationType.Percentage,
              value: 6,
            },
            {
              name: 'Gastos de cobranza',
              calculationType: ConceptCalculationType.FixedAmount,
              value: 5000,
            },
          ],
        }),
      ],
      // A different legacy rate, to prove it's ignored once concepts exist.
      99,
      today,
    );

    // conceptsInterest = 30000; moratory: 300000*0.06/30*10 (6000) + 5000
    // flat = 11000. Total interestApplied = 41000.
    expect(quote.installments[0].interestApplied).toBeCloseTo(41000, 6);
  });

  it('returns zeros for an empty installment list', () => {
    const quote = calculatePayoff([], 6, new Date('2026-01-01T12:00:00Z'));

    expect(quote).toEqual({
      installments: [],
      totalInterestOwed: 0,
      totalPrincipalOwed: 0,
      totalDue: 0,
    });
  });

  // Phase 25 (confirmed with the human, reunión 2026-08-25) —
  // LoansService.getRefinanceQuote() passes earlyMaturityWindowDays: 5 so a
  // not-yet-due installment within that window is folded into the new
  // principal too. The real early-payoff endpoints (getPayoffQuote/payoff)
  // must never pass this option, so the default (omitted) behavior stays
  // byte-for-byte the original Phase 16 rule — the first case below.
  describe('earlyMaturityWindowDays option', () => {
    it('has no effect when omitted — a not-yet-due installment within 5 days still owes zero interest', () => {
      const today = new Date('2026-01-01T12:00:00Z');
      const inFourDays = addDays(today, 4).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate: inFourDays,
            amount: 300000,
            principalPortion: 270000,
          }),
        ],
        6,
        today,
        // no options passed — must match Phase 16's real payoff behavior
      );

      expect(quote.installments[0].interestApplied).toBe(0);
      expect(quote.installments[0].totalDue).toBe(270000);
    });

    it('folds in only the corriente interest for an installment within the window, not yet actually overdue', () => {
      const today = new Date('2026-01-01T12:00:00Z');
      const inFourDays = addDays(today, 4).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate: inFourDays,
            amount: 300000,
            principalPortion: 270000,
          }),
        ],
        6,
        today,
        { earlyMaturityWindowDays: 5 },
      );

      // conceptsInterest (30000) only — overdueDays is still 0 four days
      // out, so the legacy moratory formula naturally computes to 0.
      expect(quote.installments[0].interestApplied).toBeCloseTo(30000, 6);
      expect(quote.installments[0].totalDue).toBeCloseTo(300000, 6);
    });

    it('includes an installment due in exactly 5 days — inclusive boundary', () => {
      const today = new Date('2026-01-01T12:00:00Z');
      const inFiveDays = addDays(today, 5).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate: inFiveDays,
            amount: 300000,
            principalPortion: 270000,
          }),
        ],
        6,
        today,
        { earlyMaturityWindowDays: 5 },
      );

      expect(quote.installments[0].interestApplied).toBeCloseTo(30000, 6);
    });

    it('excludes an installment due in 6 days — just outside the window', () => {
      const today = new Date('2026-01-01T12:00:00Z');
      const inSixDays = addDays(today, 6).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate: inSixDays,
            amount: 300000,
            principalPortion: 270000,
          }),
        ],
        6,
        today,
        { earlyMaturityWindowDays: 5 },
      );

      expect(quote.installments[0].interestApplied).toBe(0);
      expect(quote.installments[0].totalDue).toBe(270000);
    });

    it('still applies full corriente and moratory interest for an already-overdue installment, window or not', () => {
      const today = new Date('2026-01-11T12:00:00Z');
      const dueDate = subDays(today, 10).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [installment({ dueDate, amount: 300000, principalPortion: 270000 })],
        6,
        today,
        { earlyMaturityWindowDays: 5 },
      );

      // Same as the very first test in this file (concepts 30000 + moratory
      // 6000 = 36000) — the window only ever adds coverage for not-yet-due
      // installments, it never changes how an already-overdue one is priced.
      expect(quote.installments[0].interestApplied).toBeCloseTo(36000, 6);
    });
  });

  // Style cleanup, 2026-09-04 (client feedback — the payoff dialog's table
  // was "too simple") — conceptBreakdown is purely additive/descriptive:
  // none of these cases change interestApplied/totalDue, only what else the
  // breakdown array reports alongside them.
  describe('conceptBreakdown', () => {
    it('is empty for a not-yet-matured installment — nothing is owed yet, so nothing to itemize', () => {
      const today = new Date('2026-01-01T12:00:00Z');
      const futureDate = addDays(today, 20).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate: futureDate,
            corrienteConcepts: [{ name: 'Interés corriente', amount: 30000 }],
          }),
        ],
        6,
        today,
      );

      expect(quote.installments[0].conceptBreakdown).toEqual([]);
    });

    it('itemizes stored corriente concepts at face value for a matured installment', () => {
      const today = new Date('2026-01-11T12:00:00Z');
      const dueDate = subDays(today, 10).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate,
            amount: 300000,
            principalPortion: 270000,
            corrienteConcepts: [
              { name: 'Interés corriente', amount: 25000 },
              { name: 'Seguro', amount: 5000 },
            ],
          }),
        ],
        6,
        today,
      );

      expect(quote.installments[0].conceptBreakdown).toEqual([
        {
          name: 'Interés corriente',
          amount: 25000,
          category: ConceptCategory.Corriente,
        },
        { name: 'Seguro', amount: 5000, category: ConceptCategory.Corriente },
      ]);
    });

    it('itemizes each Phase 23 moratory concept once at least one is assigned', () => {
      const today = new Date('2026-01-11T12:00:00Z');
      const dueDate = subDays(today, 10).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate,
            amount: 300000,
            principalPortion: 270000,
            corrienteConcepts: [{ name: 'Interés corriente', amount: 30000 }],
            moratoryConcepts: [
              {
                name: 'Interés moratorio',
                calculationType: ConceptCalculationType.Percentage,
                value: 6,
              },
              {
                name: 'Gastos de cobranza',
                calculationType: ConceptCalculationType.FixedAmount,
                value: 5000,
              },
            ],
          }),
        ],
        99,
        today,
      );

      expect(quote.installments[0].conceptBreakdown).toEqual([
        {
          name: 'Interés corriente',
          amount: 30000,
          category: ConceptCategory.Corriente,
        },
        {
          name: 'Interés moratorio',
          amount: 6000, // 300000 * 0.06 / 30 * 10
          category: ConceptCategory.Moratorio,
        },
        {
          name: 'Gastos de cobranza',
          amount: 5000,
          category: ConceptCategory.Moratorio,
        },
      ]);
    });

    it('does not itemize the legacy single-rate moratory formula — no per-concept identity to itemize, same precedent as enrichInstallment.ts', () => {
      const today = new Date('2026-01-11T12:00:00Z');
      const dueDate = subDays(today, 10).toISOString().slice(0, 10);

      const quote = calculatePayoff(
        [
          installment({
            dueDate,
            amount: 300000,
            principalPortion: 270000,
            corrienteConcepts: [{ name: 'Interés corriente', amount: 30000 }],
            moratoryConcepts: [],
          }),
        ],
        6,
        today,
      );

      // interestApplied still includes the legacy moratory interest (36000
      // total, per the very first test in this file) even though it has no
      // line item of its own below.
      expect(quote.installments[0].interestApplied).toBeCloseTo(36000, 6);
      expect(quote.installments[0].conceptBreakdown).toEqual([
        {
          name: 'Interés corriente',
          amount: 30000,
          category: ConceptCategory.Corriente,
        },
      ]);
    });
  });
});
