import { ConceptCalculationType } from '../../interestConceptTypes/entities/interestConceptType.entity';
import { generateAmortizationSchedule } from '../amortization/generateSchedule';
import { InstallmentStatus } from '../entities/installment.entity';

import { calculateInterestTrueUp } from './calculateInterestTrueUp';

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
): TrueUpInstallmentInput[] {
  const schedule = generateAmortizationSchedule(2600000, 12, [
    {
      conceptTypeId: null,
      name: 'Intereses corrientes',
      calculationType: ConceptCalculationType.Percentage,
      value: 3.9,
    },
  ]);
  return schedule.map((generated) => ({
    installmentNumber: generated.installmentNumber,
    dueDate: dueDateOf(generated.installmentNumber),
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

  it('counts a not-yet-due installment inside the refinance early-maturity window', () => {
    const loan = buildLoan(paidThrough(10));
    // Cuota 11 is due 2026-08-15: 3 days away, inside a 5-day window.
    const today = new Date('2026-08-12T12:00:00Z');

    const withoutWindow = calculateInterestTrueUp(loan, today);
    const withWindow = calculateInterestTrueUp(loan, today, {
      earlyMaturityWindowDays: 5,
    });

    // Cuota 11's true interest is 16.900 vs 54.933,33 charged:
    // 84.416,70 + 16.900 - 54.933,33 = 46.383,37.
    expect(withoutWindow).toBe(84417);
    expect(withWindow).toBe(46383);
  });

  it('ignores the down payment installment and cancelled installments', () => {
    const loan = buildLoan(paidThrough(10));
    const withExtras: TrueUpInstallmentInput[] = [
      {
        installmentNumber: 0,
        dueDate: '2025-09-01',
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
});
