import { ConceptCategory } from '../../interestConceptTypes/entities/interestConceptType.entity';
import { calculateMoraCharged } from '../installments/installmentCalculations';

import { PayoffInstallmentBreakdown } from './calculatePayoff';

// Human request, 2026-11-05 — how much accrued mora a refinance may forgive.
// Same rule as a payment's mora waiver (InstallmentsService.
// assertValidMoraWaiver, docs/DATABASE.md "Mora waiver, 2026-09-25"), applied
// to every cuota the refinance quote includes:
//  - moratory interest only — never corriente interest, the interest true-up
//    or capital;
//  - per cuota, the mora it is actually *charging*: the $100-rounded total
//    minus its amount (calculateMoraCharged), the same figure the quote's
//    totalDue already reflects;
//  - never more than what that cuota still owes in the quote (a partial
//    payment already absorbed part of its interest).
export function calculateRefinanceMaxMoraWaiver(
  amountByInstallmentId: Map<string, number>,
  breakdowns: PayoffInstallmentBreakdown[],
): number {
  return breakdowns.reduce((sum, breakdown) => {
    const amount = amountByInstallmentId.get(breakdown.installmentId);
    if (amount === undefined) {
      return sum;
    }
    const moratoryInterest = breakdown.conceptBreakdown
      .filter((item) => item.category === ConceptCategory.Moratorio)
      .reduce((total, item) => total + item.amount, 0);
    const moraCharged = calculateMoraCharged(amount, moratoryInterest);
    return sum + Math.max(0, Math.min(moraCharged, breakdown.totalDue));
  }, 0);
}
