import type { Installment } from '@/features/installments/installmentsApi';

// Mirrors apps/api's calculateMoraCharged (installmentCalculations.ts) and
// InstallmentsService.assertValidMoraWaiver — the mora a payment may forgive
// (human request, 2026-09-25). Kept in lockstep on purpose: the dialogs must
// offer exactly what the server will accept, to the peso. The server stays
// the source of truth and re-checks everything against its own figures at
// the moment of the request; a mismatch here can only make it refuse, never
// apply the wrong amount.

// Same rule as the backend's roundToNearestHundred — total amounts are
// rounded to the nearest $100.
function roundToNearestHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

// What the cuota really charges as mora once the $100 rounding is applied:
// the rounded total minus the capital (NOT the raw accrued interest, which
// can differ by up to $50).
export function calculateMoraCharged(amount: number, interest: number): number {
  return Math.max(0, roundToNearestHundred(amount + interest) - amount);
}

// The most mora this cuota's next payment can forgive: what it is charging,
// but always leaving at least $1 to pay. 0 = nothing to forgive (no mora, or
// a cuota that isn't pending).
export function maxWaivableMora(
  installment: Pick<Installment, 'amount' | 'interest' | 'totalDue'>,
): number {
  const balance = Math.ceil(installment.totalDue);
  return Math.max(
    0,
    Math.min(
      calculateMoraCharged(installment.amount, installment.interest),
      balance - 1,
    ),
  );
}

// What must be paid, exactly, for the cuota to settle when `waiver` is
// forgiven: the cuota's balance minus the waiver. Whole pesos.
export function requiredPaymentWithWaiver(
  installment: Pick<Installment, 'totalDue'>,
  waiver: number,
): number {
  return Math.ceil(installment.totalDue) - waiver;
}
