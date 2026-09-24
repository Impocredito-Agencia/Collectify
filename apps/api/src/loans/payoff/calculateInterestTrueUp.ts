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
export interface InterestTrueUpBreakdown {
  // Whole pesos, floored at 0 — the full amount to add to the quote.
  total: number;
  // The part of `total` that belongs to a specific installment that is
  // still pending AND matured (its own caused-minus-charged difference), so
  // the quote can show it inside that row. Empty when total is 0.
  attributedByInstallmentNumber: Map<number, number>;
  // total minus everything attributed above: what comes from installments
  // already paid (or credited back for paid-ahead cuotas), which has no
  // pending row to sit in. May be negative in unusual prepayment cases.
  unattributed: number;
}

export function calculateInterestTrueUpBreakdown(
  installments: TrueUpInstallmentInput[],
  today: Date = new Date(),
  options: CalculateInterestTrueUpOptions = {},
): InterestTrueUpBreakdown {
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
  let pendingExact = 0;
  const pendingDifferences = new Map<number, number>();
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
      if (installment.status === InstallmentStatus.Pending) {
        pendingExact += caused - charged;
        pendingDifferences.set(
          installment.installmentNumber,
          Math.round(caused - charged),
        );
      }
    } else if (installment.status === InstallmentStatus.Paid) {
      trueUp -= charged;
    }

    balanceBefore -= installment.principalPortion ?? installment.amount;
  }

  if (Math.round(trueUp) <= 0) {
    return {
      total: 0,
      attributedByInstallmentNumber: new Map(),
      unattributed: 0,
    };
  }

  // Each part is rounded on its own and the total is their sum, so the
  // table rows plus the standalone line always add up to the total exactly
  // (rounding the grand total separately left a stray $1 "unattributed"
  // whenever several pending cuotas each rounded down — human report,
  // 2026-09-23).
  const unattributed = Math.round(trueUp - pendingExact);
  const attributedTotal = [...pendingDifferences.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  return {
    total: attributedTotal + unattributed,
    attributedByInstallmentNumber: pendingDifferences,
    unattributed,
  };
}

export function calculateInterestTrueUp(
  installments: TrueUpInstallmentInput[],
  today: Date = new Date(),
  options: CalculateInterestTrueUpOptions = {},
): number {
  return calculateInterestTrueUpBreakdown(installments, today, options).total;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
