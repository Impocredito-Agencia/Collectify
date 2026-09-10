import {
  ConceptCalculationType,
  ConceptCategory,
} from '../../interestConceptTypes/entities/interestConceptType.entity';
import { Installment, InstallmentStatus } from '../entities/installment.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';

import { enrichInstallment } from './enrichInstallment';

function buildConcept(
  overrides: Partial<LoanInstallmentConcept>,
): LoanInstallmentConcept {
  return {
    id: 'concept-row-1',
    installmentId: 'installment-1',
    installment: undefined as never,
    interestConceptTypeId: 'concept-type-1',
    interestConceptType: null,
    nameSnapshot: 'Interés remuneratorio',
    calculationType: ConceptCalculationType.Percentage,
    category: ConceptCategory.Corriente,
    value: 5,
    computedAmount: 10000,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

const moratoryConcept = buildConcept({
  id: 'concept-row-2',
  nameSnapshot: 'Interés moratorio',
  category: ConceptCategory.Moratorio,
  calculationType: ConceptCalculationType.Percentage,
  value: 6,
  computedAmount: 0,
});

describe('enrichInstallment', () => {
  const baseInstallment: Installment = {
    id: 'installment-1',
    loanId: 'loan-1',
    loan: undefined as never,
    installmentNumber: 1,
    amount: 210000,
    principalPortion: null,
    dueDate: '2026-01-01',
    status: InstallmentStatus.Pending,
    isDownPayment: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('calculates overdueDays/interest/totalDue for a regular pending installment', () => {
    const overdue = enrichInstallment(
      { ...baseInstallment, dueDate: '2020-01-01' },
      [moratoryConcept],
    );

    expect(overdue.overdueDays).toBeGreaterThan(0);
    expect(overdue.interest).toBeGreaterThan(0);
    expect(overdue.totalDue).toBeGreaterThan(baseInstallment.amount);
  });

  it('returns zero mora for a paid installment regardless of due date', () => {
    const result = enrichInstallment({
      ...baseInstallment,
      status: InstallmentStatus.Paid,
      dueDate: '2020-01-01',
    });

    expect(result).toMatchObject({ overdueDays: 0, interest: 0, totalDue: 0 });
  });

  // Removed, 2026-09-09 — this used to prove a pre-Phase-23 loan (zero
  // moratory concepts) fell back to a legacy single-rate formula
  // (Loan.interestRate). That fallback and the column were both dropped
  // once verified dead — see this function's own doc comment. Replaced
  // with the simpler, current behavior: no moratory concepts means no
  // mora, full stop.
  it('reports zero mora when no moratory concepts are assigned, regardless of how overdue', () => {
    const result = enrichInstallment(
      { ...baseInstallment, dueDate: '2020-01-01' },
      [buildConcept({ category: ConceptCategory.Corriente })],
    );

    expect(result.interest).toBe(0);
    expect(result.conceptBreakdown).toEqual([
      {
        name: 'Interés remuneratorio',
        amount: 10000,
        category: 'corriente',
        value: 5,
        calculationType: ConceptCalculationType.Percentage,
      },
    ]);
  });

  it('computes moratory interest from the assigned moratory concepts', () => {
    const result = enrichInstallment(
      { ...baseInstallment, dueDate: '2020-01-01' },
      [buildConcept({ category: ConceptCategory.Corriente }), moratoryConcept],
    );

    expect(result.interest).toBeGreaterThan(0);
    expect(result.conceptBreakdown).toEqual([
      {
        name: 'Interés remuneratorio',
        amount: 10000,
        category: 'corriente',
        value: 5,
        calculationType: ConceptCalculationType.Percentage,
      },
      {
        name: 'Interés moratorio',
        amount: result.interest,
        category: 'moratorio',
        value: 6,
        calculationType: ConceptCalculationType.Percentage,
      },
    ]);
  });

  it('omits moratory charges entirely for a paid installment, even with concepts assigned', () => {
    const result = enrichInstallment(
      {
        ...baseInstallment,
        status: InstallmentStatus.Paid,
        dueDate: '2020-01-01',
      },
      [buildConcept({ category: ConceptCategory.Corriente }), moratoryConcept],
    );

    expect(result.interest).toBe(0);
    expect(result.conceptBreakdown).toEqual([
      {
        name: 'Interés remuneratorio',
        amount: 10000,
        category: 'corriente',
        value: 5,
        calculationType: ConceptCalculationType.Percentage,
      },
    ]);
  });

  // Bug fix, 2026-09-07 (préstamo #0920) — totalDue must net out payments
  // already registered against this same installment, not just report its
  // full nominal cost every time.
  describe('totalPaid', () => {
    it('subtracts a partial payment from totalDue, leaving the real remaining balance', () => {
      const noPayment = enrichInstallment(baseInstallment);
      const withPartialPayment = enrichInstallment(baseInstallment, [], 150000);

      expect(withPartialPayment.totalDue).toBe(noPayment.totalDue - 150000);
    });

    it('never goes below 0, even if totalPaid exceeds totalDue', () => {
      const result = enrichInstallment(baseInstallment, [], 999999999);

      expect(result.totalDue).toBe(0);
    });

    it('defaults to 0 (no behavior change) when totalPaid is omitted', () => {
      const withDefault = enrichInstallment(baseInstallment);
      const withExplicitZero = enrichInstallment(baseInstallment, [], 0);

      expect(withDefault.totalDue).toBe(withExplicitZero.totalDue);
    });

    it('still reports totalDue 0 for a paid installment regardless of totalPaid', () => {
      const result = enrichInstallment(
        { ...baseInstallment, status: InstallmentStatus.Paid },
        [],
        150000,
      );

      expect(result.totalDue).toBe(0);
    });
  });
});
