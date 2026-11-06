import { ConceptCategory } from '../../interestConceptTypes/entities/interestConceptType.entity';

import { PayoffInstallmentBreakdown } from './calculatePayoff';
import { calculateRefinanceMaxMoraWaiver } from './calculateRefinanceMaxMoraWaiver';

function breakdown(
  installmentId: string,
  totalDue: number,
  items: { category: ConceptCategory; amount: number }[],
): PayoffInstallmentBreakdown {
  return {
    installmentId,
    installmentNumber: 1,
    interestApplied: 0,
    principalApplied: 0,
    totalDue,
    conceptBreakdown: items.map((item) => ({ name: 'x', ...item })),
  };
}

describe('calculateRefinanceMaxMoraWaiver', () => {
  it('adds up the mora each overdue cuota is charging, rounded like the cuota total', () => {
    const amounts = new Map([
      ['a', 588000],
      ['b', 500000],
    ]);

    const max = calculateRefinanceMaxMoraWaiver(amounts, [
      // 588000 + 12344.6 → 600300 total, so 12300 of mora is charged.
      breakdown('a', 600300, [
        { category: ConceptCategory.Corriente, amount: 40000 },
        { category: ConceptCategory.Moratorio, amount: 12344.6 },
      ]),
      breakdown('b', 510000, [
        { category: ConceptCategory.Moratorio, amount: 10000 },
      ]),
    ]);

    expect(max).toBe(12300 + 10000);
  });

  it('never counts corriente interest', () => {
    const max = calculateRefinanceMaxMoraWaiver(new Map([['a', 500000]]), [
      breakdown('a', 540000, [
        { category: ConceptCategory.Corriente, amount: 40000 },
      ]),
    ]);

    expect(max).toBe(0);
  });

  it('is 0 for a cuota that is not due yet (no breakdown items)', () => {
    const max = calculateRefinanceMaxMoraWaiver(new Map([['a', 500000]]), [
      breakdown('a', 420000, []),
    ]);

    expect(max).toBe(0);
  });

  it('caps a cuota at what it still owes after a partial payment', () => {
    const max = calculateRefinanceMaxMoraWaiver(new Map([['a', 500000]]), [
      breakdown('a', 4000, [
        { category: ConceptCategory.Moratorio, amount: 10000 },
      ]),
    ]);

    expect(max).toBe(4000);
  });
});
