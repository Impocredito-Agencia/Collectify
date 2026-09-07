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
      6,
    );

    expect(overdue.overdueDays).toBeGreaterThan(0);
    expect(overdue.interest).toBeGreaterThan(0);
    expect(overdue.totalDue).toBeGreaterThan(baseInstallment.amount);
  });

  it('returns zero mora for a paid installment regardless of due date', () => {
    const result = enrichInstallment(
      {
        ...baseInstallment,
        status: InstallmentStatus.Paid,
        dueDate: '2020-01-01',
      },
      6,
    );

    expect(result).toMatchObject({ overdueDays: 0, interest: 0, totalDue: 0 });
  });

  it('falls back to the legacy interestRate formula when no moratory concepts are assigned', () => {
    const withoutConcepts = enrichInstallment(
      { ...baseInstallment, dueDate: '2020-01-01' },
      6,
      [buildConcept({ category: ConceptCategory.Corriente })],
    );
    const legacyOnly = enrichInstallment(
      { ...baseInstallment, dueDate: '2020-01-01' },
      6,
    );

    // A corriente-only concept list must not change the mora number at
    // all — only assigned MORATORIO concepts switch the engine.
    expect(withoutConcepts.interest).toBe(legacyOnly.interest);
    expect(withoutConcepts.conceptBreakdown).toEqual([
      {
        name: 'Interés remuneratorio',
        amount: 10000,
        category: 'corriente',
        value: 5,
        calculationType: ConceptCalculationType.Percentage,
      },
    ]);
  });

  it('uses the assigned moratory concepts instead of the legacy formula once at least one is present', () => {
    const result = enrichInstallment(
      { ...baseInstallment, dueDate: '2020-01-01' },
      6,
      [
        buildConcept({ category: ConceptCategory.Corriente }),
        buildConcept({
          id: 'concept-row-2',
          nameSnapshot: 'Interés moratorio',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          value: 6,
          computedAmount: 0,
        }),
      ],
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
      6,
      [
        buildConcept({ category: ConceptCategory.Corriente }),
        buildConcept({
          id: 'concept-row-2',
          category: ConceptCategory.Moratorio,
        }),
      ],
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
});
