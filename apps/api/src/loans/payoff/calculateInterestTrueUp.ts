import { calculateDaysUntilDue } from '../installments/installmentCalculations';
import { InstallmentStatus } from '../entities/installment.entity';

export interface TrueUpPercentageConcept {
  // Rate per period (e.g. 3.9), as snapshotted on the concept row.
  value: number;
  // What was actually charged on this installment — the smoothed figure.
  computedAmount: number;
}

export interface TrueUpInstallmentInput {
  installmentNumber: number;
  dueDate: string;
  status: InstallmentStatus;
  isDownPayment: boolean;
  amount: number;
  principalPortion: number | null;
  // Corriente concepts of type Percentage only — fixed-amount concepts are
  // not smoothed, so they never differ from their true figure.
  percentageConcepts: TrueUpPercentageConcept[];
}

export interface CalculateInterestTrueUpOptions {
  earlyMaturityWindowDays?: number;
}

// The amortization smoothing (see generateSchedule.ts) charges the same
// cuota every period, so early cuotas carry LESS percentage interest than
// the balance-proportional figure and late cuotas MORE. Paying off or
// refinancing mid-schedule must therefore settle the difference: interest
// caused to date (balance-proportional, per matured installment) minus the
// interest actually charged on those installments — otherwise the client
// walks away owing less interest than the loan really caused. Confirmed
// with the human, 2026-09-23 (préstamo de 2.600.000 a 12 cuotas al 3,9%,
// 10 cuotas pagadas: liquidación = 433.333,30 capital + 84.417 ajuste).
//
// Paid installments that are NOT yet matured already collected interest for
// a period that hasn't been caused — that is credited back. Never negative:
// the result is floored at 0, so this can only ever add to what the
// pre-existing capital-only payoff charged.
export function calculateInterestTrueUp(
  installments: TrueUpInstallmentInput[],
  today: Date = new Date(),
  options: CalculateInterestTrueUpOptions = {},
): number {
  const amortizing = installments
    .filter(
      (installment) =>
        !installment.isDownPayment &&
        installment.status !== InstallmentStatus.Cancelled,
    )
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  const window = options.earlyMaturityWindowDays ?? 0;
  let balanceBefore = amortizing.reduce(
    (sum, installment) =>
      sum + (installment.principalPortion ?? installment.amount),
    0,
  );

  let trueUp = 0;
  for (const installment of amortizing) {
    const hasMatured =
      calculateDaysUntilDue(new Date(installment.dueDate), today) <= window;
    const charged = installment.percentageConcepts.reduce(
      (sum, concept) => sum + concept.computedAmount,
      0,
    );

    if (hasMatured) {
      const caused = installment.percentageConcepts.reduce(
        (sum, concept) =>
          sum + roundCents((balanceBefore * concept.value) / 100),
        0,
      );
      trueUp += caused - charged;
    } else if (installment.status === InstallmentStatus.Paid) {
      trueUp -= charged;
    }

    balanceBefore -= installment.principalPortion ?? installment.amount;
  }

  return Math.max(0, Math.round(trueUp));
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
