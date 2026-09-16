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

// A single percentage moratory concept at 6% — used throughout to exercise
// the moratory-interest math (Loan.interestRate, the pre-Phase-23
// single-rate fallback this used to also cover, was removed 2026-09-09
// once every loan creation path was confirmed to always assign at least
// one real moratory concept — see calculatePayoff.ts's own note).
const moratoryConceptAt6Percent = {
  name: 'Interés moratorio',
  calculationType: ConceptCalculationType.Percentage,
  value: 6,
};

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
      [
        installment({
          dueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
      ],
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
    // 15 days — comfortably past the mora grace period (see
    // installmentCalculations.ts's MORA_GRACE_PERIOD_DAYS) so this keeps
    // testing genuine multi-installment mora summation.
    const overdueDate = subDays(today, 15).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          installmentId: 'inst-1',
          installmentNumber: 1,
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
        installment({
          installmentId: 'inst-2',
          installmentNumber: 2,
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
      ],
      today,
    );

    expect(quote.installments).toHaveLength(2);
    expect(quote.totalPrincipalOwed).toBe(540000);
    // Each installment: conceptsInterest 30000 + moratory (300000*0.06/30*15=9000) = 39000
    expect(quote.totalInterestOwed).toBeCloseTo(78000, 6);
    expect(quote.totalDue).toBeCloseTo(618000, 6);
  });

  // Bug fix, 2026-09-08 (human report) — the business doesn't charge mora
  // during an installment's first N overdue days (see
  // installmentCalculations.ts's MORA_GRACE_PERIOD_DAYS). This used to be
  // enforced only in which WhatsApp template got picked, never in the
  // actual money calculation, so a payoff quote for a cuota inside its
  // grace period silently included mora it shouldn't have.
  //
  // Narrowed from 8 to 6 days, 2026-09-09 (client correction) — day 6
  // still has no mora, day 7 already does.
  it('charges no moratory interest for an installment still inside its 6-day grace period', () => {
    const today = new Date('2026-02-01T12:00:00Z');
    const overdueDate = subDays(today, 6).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
      ],
      today,
    );

    // conceptsInterest 30000 + moratory (0, still within the grace period) = 30000
    expect(quote.installments[0]).toMatchObject({
      interestApplied: 30000,
      principalApplied: 270000,
      totalDue: 300000,
    });
  });

  it('charges moratory interest starting day 7, once the grace period has passed', () => {
    const today = new Date('2026-02-01T12:00:00Z');
    const overdueDate = subDays(today, 7).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          dueDate: overdueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
      ],
      today,
    );

    // moratory = 300000 * 0.06 / 30 * 7 = 4200. conceptsInterest 30000 +
    // moratory 4200 = 34200.
    expect(quote.installments[0]).toMatchObject({
      interestApplied: 34200,
      principalApplied: 270000,
      totalDue: 304200,
    });
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
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
      ],
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
          moratoryConcepts: [moratoryConceptAt6Percent],
        }),
      ],
      today,
    );

    // No concept charges possible without a principal/concept split, so
    // interestApplied is purely the moratory formula: 300000*0.06/30*10.
    expect(quote.installments[0].interestApplied).toBeCloseTo(6000, 6);
    expect(quote.installments[0].principalApplied).toBe(300000);
  });

  it('computes moratory interest correctly with more than one moratory concept, mixing percentage and fixed_amount', () => {
    const today = new Date('2026-01-11T12:00:00Z');
    const dueDate = subDays(today, 10).toISOString().slice(0, 10);

    const quote = calculatePayoff(
      [
        installment({
          dueDate,
          amount: 300000,
          principalPortion: 270000,
          moratoryConcepts: [
            moratoryConceptAt6Percent,
            {
              name: 'Gastos de cobranza',
              calculationType: ConceptCalculationType.FixedAmount,
              value: 5000,
            },
          ],
        }),
      ],
      today,
    );

    // conceptsInterest = 30000; moratory: 300000*0.06/30*10 (6000) + 5000
    // flat = 11000. Total interestApplied = 41000.
    expect(quote.installments[0].interestApplied).toBeCloseTo(41000, 6);
  });

  it('returns zeros for an empty installment list', () => {
    const quote = calculatePayoff([], new Date('2026-01-01T12:00:00Z'));

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
        today,
        { earlyMaturityWindowDays: 5 },
      );

      // conceptsInterest (30000) only — overdueDays is still 0 four days
      // out, so moratory interest naturally computes to 0.
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
        [
          installment({
            dueDate,
            amount: 300000,
            principalPortion: 270000,
            moratoryConcepts: [moratoryConceptAt6Percent],
          }),
        ],
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
              moratoryConceptAt6Percent,
              {
                name: 'Gastos de cobranza',
                calculationType: ConceptCalculationType.FixedAmount,
                value: 5000,
              },
            ],
          }),
        ],
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
          calculationType: ConceptCalculationType.Percentage,
          value: 6,
        },
        {
          name: 'Gastos de cobranza',
          amount: 5000,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.FixedAmount,
          value: 5000,
        },
      ]);
    });

    // Removed, 2026-09-09 — this used to prove a zero-moratory-concepts
    // installment still accrued mora via the legacy single-rate formula
    // (Loan.interestRate). That formula and the column were both dropped
    // once verified dead — see calculatePayoff.ts's own note. Replaced with
    // the current, simpler behavior: zero moratory concepts means zero
    // moratory interest, full stop.
    it('accrues zero moratory interest for a matured installment with zero moratory concepts assigned', () => {
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
        today,
      );

      expect(quote.installments[0].interestApplied).toBeCloseTo(30000, 6);
      expect(quote.installments[0].conceptBreakdown).toEqual([
        {
          name: 'Interés corriente',
          amount: 30000,
          category: ConceptCategory.Corriente,
        },
      ]);
    });
  });

  // Bug fix, 2026-09-15 (human report) — a Pending installment with a
  // prior partial payment used to be quoted/charged at its full nominal
  // cost all over again, the same class of bug as préstamo #0920's
  // overcharge in a separate code path (see docs/DATABASE.md's "Known
  // gap, flagged 2026-09-07"). Every case here reuses the exact same
  // overdue installment as the very first test above (amount 300000,
  // principalPortion 270000, 10 days overdue, 6% moratory concept) — gross
  // interestApplied 36000, principalApplied 270000, totalDue 306000 —
  // so each totalPaid variant below is easy to check against that same
  // known baseline.
  describe('totalPaid netting', () => {
    const today = new Date('2026-01-11T12:00:00Z');
    const dueDate = subDays(today, 10).toISOString().slice(0, 10);

    function overdueInstallment(totalPaid: number) {
      return installment({
        dueDate,
        amount: 300000,
        principalPortion: 270000,
        moratoryConcepts: [moratoryConceptAt6Percent],
        totalPaid,
      });
    }

    it('is unaffected when nothing has been paid yet (totalPaid defaults to 0)', () => {
      const quote = calculatePayoff([installment({ dueDate })], today);
      // No moratory concept on this one — plain baseline from the very
      // first test in this file, just confirming totalPaid's absence
      // changes nothing.
      expect(quote.installments[0].totalDue).toBe(
        calculatePayoff([installment({ dueDate, totalPaid: 0 })], today)
          .installments[0].totalDue,
      );
    });

    it('nets a partial payment smaller than the accrued interest off interest only', () => {
      const quote = calculatePayoff([overdueInstallment(10000)], today);

      expect(quote.installments[0]).toMatchObject({
        interestApplied: 26000, // 36000 - 10000
        principalApplied: 270000, // untouched — the payment never reached principal
        totalDue: 296000,
      });
    });

    it('zeroes interest exactly when the prior payment equals it, leaving principal untouched', () => {
      const quote = calculatePayoff([overdueInstallment(36000)], today);

      expect(quote.installments[0]).toMatchObject({
        interestApplied: 0,
        principalApplied: 270000,
        totalDue: 270000,
      });
    });

    it('spills the remainder into principal once the prior payment exceeds accrued interest (Art. 1653 — interest first)', () => {
      const quote = calculatePayoff([overdueInstallment(50000)], today);

      expect(quote.installments[0]).toMatchObject({
        interestApplied: 0,
        principalApplied: 256000, // 270000 - (50000 - 36000)
        totalDue: 256000,
      });
    });

    it('floors at zero rather than going negative once the prior payment covers everything owed', () => {
      const quote = calculatePayoff([overdueInstallment(500000)], today);

      expect(quote.installments[0]).toMatchObject({
        interestApplied: 0,
        principalApplied: 0,
        totalDue: 0,
      });
    });

    it('nets a prior payment straight off principal for a not-yet-matured installment (no interest to absorb it first)', () => {
      const futureDueDate = addDays(today, 5).toISOString().slice(0, 10);
      const quote = calculatePayoff(
        [
          installment({
            dueDate: futureDueDate,
            amount: 300000,
            principalPortion: 270000,
            moratoryConcepts: [moratoryConceptAt6Percent],
            totalPaid: 100000,
          }),
        ],
        today,
      );

      expect(quote.installments[0]).toMatchObject({
        interestApplied: 0,
        principalApplied: 170000, // 270000 - 100000
        totalDue: 170000,
      });
    });

    it('nets totalPaid per installment, independently, across several pending installments', () => {
      const quote = calculatePayoff(
        [
          overdueInstallment(36000), // first installment's own payment...
          installment({
            installmentId: 'inst-2',
            installmentNumber: 2,
            dueDate,
            amount: 300000,
            principalPortion: 270000,
            moratoryConcepts: [moratoryConceptAt6Percent],
            totalPaid: 0, // ...never touches the second installment's own balance
          }),
        ],
        today,
      );

      expect(quote.installments[0].totalDue).toBe(270000);
      expect(quote.installments[1].totalDue).toBe(306000);
      expect(quote.totalDue).toBe(270000 + 306000);
    });
  });

  // Bug fix, 2026-09-15 (human report) — a payoff quote's totalDue used to
  // be the raw, unrounded principal+interest sum, while the loan detail
  // view's totalDue (enrichInstallment.ts) always rounds that same sum to
  // the nearest $100 (calculateTotalDue) — the two disagreed by whatever
  // the rounding moved, confusing a cobrador comparing them side by side.
  // Every test above this point happens to land on a round hundred
  // already (moratoryInterest was always an exact multiple of 100 in
  // those fixtures), so this block deliberately picks a rate/day count
  // that DOESN'T, to actually exercise the rounding path.
  describe('totalDue rounding — matches the loan detail view', () => {
    const today = new Date('2026-01-14T12:00:00Z');
    const dueDate = subDays(today, 13).toISOString().slice(0, 10);
    const moratoryConceptAt5Percent = {
      name: 'Interés moratorio',
      calculationType: ConceptCalculationType.Percentage,
      value: 5,
    };

    it('rounds the gross total to the nearest $100, same as calculateTotalDue', () => {
      const quote = calculatePayoff(
        [
          installment({
            dueDate,
            amount: 250000,
            principalPortion: 220000,
            moratoryConcepts: [moratoryConceptAt5Percent],
          }),
        ],
        today,
      );

      // conceptsInterest = 250000 - 220000 = 30000
      // moratoryInterest = round(250000 * 0.05 / 30 * 13) = round(5416.67) = 5417
      // gross = 30000 + 5417 = 35417 -> rounds to 255417 -> nearest 100 = 255400
      // (the OLD, unrounded behavior would have quoted 255417 instead)
      expect(quote.installments[0]).toMatchObject({
        interestApplied: 35417,
        principalApplied: 219983, // absorbs the 17-peso rounding delta
        totalDue: 255400,
      });
    });

    it('nets totalPaid off the already-rounded total, same order as enrichInstallment', () => {
      const quote = calculatePayoff(
        [
          installment({
            dueDate,
            amount: 250000,
            principalPortion: 220000,
            moratoryConcepts: [moratoryConceptAt5Percent],
            totalPaid: 10000,
          }),
        ],
        today,
      );

      // Rounds first (255400), THEN subtracts the prior payment — same
      // sequence as enrichInstallment.ts's own totalDue, not rounded a
      // second time afterward.
      expect(quote.installments[0].totalDue).toBe(245400);
    });
  });
});
