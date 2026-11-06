import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';

import { Installment, InstallmentStatus } from './entities/installment.entity';
import { InstallmentFrequency, Loan, LoanStatus } from './entities/loan.entity';
import { LoanInstallmentConcept } from './entities/loanInstallmentConcept.entity';
import { buildOriginationTerms } from './originationTerms';

const loan = {
  id: 'loan-1',
  promissoryNoteNumber: '#0907',
  status: LoanStatus.Active,
  disbursedAt: '2026-07-10',
  createdAt: new Date('2026-07-10T15:00:00Z'),
  principalAmount: 2600000,
  installmentFrequency: InstallmentFrequency.Monthly,
  refinancedFromLoanId: null,
  refinanceMoraWaivedAmount: 0,
  refinanceMoraWaiverReason: null,
} as unknown as Loan;

function installment(
  installmentNumber: number,
  amount: number,
  isDownPayment = false,
): Installment {
  return {
    id: `inst-${installmentNumber}`,
    installmentNumber,
    amount,
    isDownPayment,
    status: InstallmentStatus.Pending,
  } as Installment;
}

function concept(
  overrides: Partial<LoanInstallmentConcept>,
): LoanInstallmentConcept {
  return {
    installmentId: 'inst-2',
    interestConceptTypeId: null,
    nameSnapshot: 'Intereses corrientes',
    calculationType: ConceptCalculationType.Percentage,
    category: ConceptCategory.Corriente,
    value: 3.9,
    computedAmount: 0,
    ...overrides,
  } as LoanInstallmentConcept;
}

describe('buildOriginationTerms', () => {
  it('reads the system rates, cuota inicial and first financed cuota as stored', () => {
    const terms = buildOriginationTerms(
      loan,
      [
        installment(3, 271600),
        installment(1, 500000, true),
        installment(2, 271600),
      ],
      [
        concept({}),
        concept({
          category: ConceptCategory.Moratorio,
          nameSnapshot: 'Intereses moratorios',
          value: 2.1,
        }),
        concept({
          interestConceptTypeId: 'fee-1',
          nameSnapshot: 'Estudio de crédito',
          calculationType: ConceptCalculationType.FixedAmount,
          value: 20000,
        }),
      ],
    );

    expect(terms).toMatchObject({
      principalAmount: 2600000,
      financedInstallments: 2,
      downPaymentAmount: 500000,
      installmentAmount: 271600,
      corrienteInterestRate: 3.9,
      moratoryInterestRate: 2.1,
      otherCharges: [
        {
          name: 'Estudio de crédito',
          category: ConceptCategory.Corriente,
          calculationType: ConceptCalculationType.FixedAmount,
          value: 20000,
        },
      ],
    });
  });

  it('reports a rate that was never stored as null, without inventing one', () => {
    const terms = buildOriginationTerms(loan, [installment(1, 300000)], []);

    expect(terms.corrienteInterestRate).toBeNull();
    expect(terms.moratoryInterestRate).toBeNull();
    expect(terms.downPaymentAmount).toBeNull();
    expect(terms.otherCharges).toEqual([]);
  });

  it('does not take a catalog fee for the system rate of its category', () => {
    const terms = buildOriginationTerms(
      loan,
      [installment(1, 300000)],
      [concept({ interestConceptTypeId: 'fee-1', value: 1.5 })],
    );

    expect(terms.corrienteInterestRate).toBeNull();
    expect(terms.otherCharges).toHaveLength(1);
  });

  it('carries the mora forgiven when this loan was refinanced', () => {
    const terms = buildOriginationTerms(
      {
        ...loan,
        refinancedFromLoanId: 'loan-0',
        refinanceMoraWaivedAmount: 45000,
        refinanceMoraWaiverReason: 'Refinancia al día',
      },
      [],
      [],
    );

    expect(terms).toMatchObject({
      refinancedFromLoanId: 'loan-0',
      refinanceMoraWaivedAmount: 45000,
      refinanceMoraWaiverReason: 'Refinancia al día',
      financedInstallments: 0,
      installmentAmount: null,
    });
  });
});
