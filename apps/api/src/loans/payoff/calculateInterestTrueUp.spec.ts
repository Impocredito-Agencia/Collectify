import { ConceptCalculationType } from '../../interestConceptTypes/entities/interestConceptType.entity';
import { generateAmortizationSchedule } from '../amortization/generateSchedule';
import { InstallmentStatus } from '../entities/installment.entity';

import {
  calculateInterestTrueUp,
  calculateInterestTrueUpBreakdown,
} from './calculateInterestTrueUp';

import type { TrueUpInstallmentInput } from './calculateInterestTrueUp';

// Anchored at noon UTC (7am Bogotá) — see calculatePayoff.spec.ts's note.
const TODAY_AFTER_10TH_DUE = new Date('2026-08-01T12:00:00Z');

// Installment k is due on the 15th, k-1 months after 2025-10-15: the 10th
// fell on 2026-07-15, the 11th on 2026-08-15, the 12th on 2026-09-15.
function dueDateOf(installmentNumber: number): string {
  const date = new Date(Date.UTC(2025, 9 + installmentNumber - 1, 15));
  return date.toISOString().slice(0, 10);
}

// The real generator, on the worked example agreed with the human
// (2026-09-23): 2.600.000, 12 cuotas, 3,9% per period -> flat cuota of
// $271.600, true (balance-proportional) interest 101.400, 92.950, ...
function buildLoan(
  statuses: Record<number, InstallmentStatus> = {},
  { principal = 2600000, count = 12, rate = 3.9 } = {},
): TrueUpInstallmentInput[] {
  const schedule = generateAmortizationSchedule(principal, count, [
    {
      conceptTypeId: null,
      name: 'Intereses corrientes',
      calculationType: ConceptCalculationType.Percentage,
      value: rate,
    },
  ]);
  return schedule.map((generated) => ({
    installmentNumber: generated.installmentNumber,
    dueDate: dueDateOf(generated.installmentNumber),
    // Each installment's period starts when the previous one became due —
    // dueDateOf(0) stands in for the loan's disbursement date, one period
    // before cuota 1.
    periodStartDate: dueDateOf(generated.installmentNumber - 1),
    status: statuses[generated.installmentNumber] ?? InstallmentStatus.Pending,
    isDownPayment: false,
    amount: generated.amount,
    principalPortion: generated.principalPortion,
    percentageConcepts: generated.concepts.map((concept) => ({
      value: concept.value,
      computedAmount: concept.computedAmount,
    })),
  }));
}

function paidThrough(count: number): Record<number, InstallmentStatus> {
  const statuses: Record<number, InstallmentStatus> = {};
  for (let number = 1; number <= count; number++) {
    statuses[number] = InstallmentStatus.Paid;
  }
  return statuses;
}

describe('calculateInterestTrueUp', () => {
  it('settles the interest the smoothed cuotas under-charged so far (10 paid of 12)', () => {
    const loan = buildLoan(paidThrough(10));

    // True interest of cuotas 1-10 is 633.750; 10 flat cuotas charged
    // 10 x 54.933,33 = 549.333,30 -> 84.417 still owed.
    expect(calculateInterestTrueUp(loan, TODAY_AFTER_10TH_DUE)).toBe(84417);
  });

  it('is 0 when no installment has matured yet', () => {
    const loan = buildLoan();

    expect(
      calculateInterestTrueUp(loan, new Date('2025-01-01T12:00:00Z')),
    ).toBe(0);
  });

  it('grows then shrinks across the schedule (largest mid-way, ~0 at the end)', () => {
    const at = (count: number) =>
      calculateInterestTrueUp(
        buildLoan(paidThrough(count)),
        new Date(`${dueDateOf(count)}T12:00:00Z`),
      );

    expect(at(1)).toBe(46467);
    expect(at(6)).toBe(152050);
    expect(at(10)).toBe(84417);
    expect(at(12)).toBe(0);
  });

  it('credits interest already collected on a paid, not-yet-due installment', () => {
    // Cuota 11 paid ahead of its due date: its 54.933,33 of charged
    // interest covers a period not yet caused -> 84.416,70 - 54.933,33.
    const loan = buildLoan({
      ...paidThrough(10),
      11: InstallmentStatus.Paid,
    });

    expect(calculateInterestTrueUp(loan, TODAY_AFTER_10TH_DUE)).toBe(29483);
  });

  it('never returns a negative amount, even when more was prepaid than caused', () => {
    const loan = buildLoan({
      1: InstallmentStatus.Paid,
      2: InstallmentStatus.Paid,
      3: InstallmentStatus.Paid,
      4: InstallmentStatus.Paid,
    });

    expect(
      calculateInterestTrueUp(loan, new Date('2025-10-01T12:00:00Z')),
    ).toBe(0);
  });

  // Human correction, 2026-09-30 — the grace period counts forward from
  // when the installment's OWN period started (its previous cuota's
  // dueDate — 2026-07-15 for cuota 11, see dueDateOf's own comment), not
  // backward from its dueDate (2026-08-15, still a month away here).
  it('counts a not-yet-due installment once its own period has run for interestAccrualGraceDays days', () => {
    const loan = buildLoan(paidThrough(10));
    const fourDaysIntoCuota11 = new Date('2026-07-19T12:00:00Z');
    const fiveDaysIntoCuota11 = new Date('2026-07-20T12:00:00Z');

    const stillInsideGrace = calculateInterestTrueUp(
      loan,
      fourDaysIntoCuota11,
      {
        interestAccrualGraceDays: 5,
      },
    );
    const graceJustElapsed = calculateInterestTrueUp(
      loan,
      fiveDaysIntoCuota11,
      {
        interestAccrualGraceDays: 5,
      },
    );

    // Cuota 11's true interest is 16.900 vs 54.933,33 charged:
    // 84.416,70 + 16.900 - 54.933,33 = 46.383,37 — reported as the sum of
    // its independently rounded parts, 84.417 - 38.033.
    expect(stillInsideGrace).toBe(84417);
    expect(graceJustElapsed).toBe(46384);
  });

  it('has no effect when omitted, even weeks into a not-yet-due installment’s period', () => {
    const loan = buildLoan(paidThrough(10));

    expect(
      calculateInterestTrueUp(loan, new Date('2026-08-12T12:00:00Z')),
    ).toBe(84417);
  });

  it('ignores the down payment installment and cancelled installments', () => {
    const loan = buildLoan(paidThrough(10));
    const withExtras: TrueUpInstallmentInput[] = [
      {
        installmentNumber: 0,
        dueDate: '2025-09-01',
        periodStartDate: '2025-08-01',
        status: InstallmentStatus.Paid,
        isDownPayment: true,
        amount: 500000,
        principalPortion: 500000,
        percentageConcepts: [],
      },
      ...loan,
      {
        installmentNumber: 13,
        dueDate: '2026-01-01',
        periodStartDate: '2025-12-01',
        status: InstallmentStatus.Cancelled,
        isDownPayment: false,
        amount: 999999,
        principalPortion: 999999,
        percentageConcepts: [{ value: 3.9, computedAmount: 1 }],
      },
    ];

    expect(calculateInterestTrueUp(withExtras, TODAY_AFTER_10TH_DUE)).toBe(
      84417,
    );
  });

  it('returns 0 for a loan with no percentage concepts', () => {
    const loan = buildLoan(paidThrough(10)).map((installment) => ({
      ...installment,
      percentageConcepts: [],
    }));

    expect(calculateInterestTrueUp(loan, TODAY_AFTER_10TH_DUE)).toBe(0);
  });

  it('returns 0 for an empty installment list', () => {
    expect(calculateInterestTrueUp([], TODAY_AFTER_10TH_DUE)).toBe(0);
  });
  describe('calculateInterestTrueUpBreakdown', () => {
    // 1.000.000 / 10 cuotas / 4,5%: flat cuota 124.800, cuota 1 charges
    // 24.800 of interest but really caused 45.000.
    const small = { principal: 1000000, count: 10, rate: 4.5 };
    const afterFirstDue = new Date('2025-10-26T12:00:00Z'); // 11 days after cuota 1

    it('places a pending, matured installment’s difference on its own row', () => {
      const loan = buildLoan({}, small);

      const result = calculateInterestTrueUpBreakdown(loan, afterFirstDue);

      expect(result.total).toBe(20200);
      expect(result.attributedByInstallmentNumber.get(1)).toBe(20200);
      expect(result.unattributed).toBe(0);
    });

    it('leaves the difference of already-paid installments unattributed', () => {
      const loan = buildLoan(paidThrough(10), {
        principal: 2600000,
        count: 12,
        rate: 3.9,
      });

      const result = calculateInterestTrueUpBreakdown(
        loan,
        TODAY_AFTER_10TH_DUE,
      );

      expect(result.total).toBe(84417);
      expect(result.attributedByInstallmentNumber.size).toBe(0);
      expect(result.unattributed).toBe(84417);
    });

    it('splits between a paid cuota (unattributed) and a pending matured one (own row)', () => {
      const loan = buildLoan({ 1: InstallmentStatus.Paid }, small);
      const afterSecondDue = new Date('2025-11-20T12:00:00Z');

      const result = calculateInterestTrueUpBreakdown(loan, afterSecondDue);

      // Cuota 1: 45.000 - 24.800 = 20.200. Cuota 2: 900.000 x 4,5% =
      // 40.500 vs 24.800 charged = 15.700.
      expect(result.attributedByInstallmentNumber.get(2)).toBe(15700);
      expect(result.unattributed).toBe(20200);
      expect(result.total).toBe(35900);
    });

    it('attributes nothing when the total is floored to 0', () => {
      const result = calculateInterestTrueUpBreakdown(
        buildLoan(),
        new Date('2025-01-01T12:00:00Z'),
      );

      expect(result.total).toBe(0);
      expect(result.attributedByInstallmentNumber.size).toBe(0);
      expect(result.unattributed).toBe(0);
    });

    it('adds up exactly when several pending cuotas each round down (préstamo #0930)', () => {
      // 1.000.000 / 12 / 4,5%, nothing paid, cuotas 1 and 2 overdue: the
      // exact differences are 20.633,33 and 16.883,33 (sum 37.516,67).
      const loan = buildLoan({}, { principal: 1000000, count: 12, rate: 4.5 });
      const afterSecondDue = new Date('2025-11-20T12:00:00Z');

      const result = calculateInterestTrueUpBreakdown(loan, afterSecondDue);
      const attributed = [...result.attributedByInstallmentNumber.values()];

      expect(result.unattributed).toBe(0);
      expect(result.total).toBe(
        attributed.reduce((sum, value) => sum + value, 0),
      );
    });
  });
});
