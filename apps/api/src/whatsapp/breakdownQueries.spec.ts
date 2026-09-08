import { In, Repository } from 'typeorm';

import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { findInstallmentsBreakdownByIds } from './breakdownQueries';

function buildInstallment(overrides: Partial<Installment> = {}): Installment {
  const loan: Loan = {
    id: 'loan-1',
    clientId: 'client-1',
    promissoryNoteNumber: '#743',
    interestRate: 0,
    status: LoanStatus.Active,
  } as Loan;

  return {
    id: 'installment-1',
    loanId: loan.id,
    loan,
    installmentNumber: 3,
    amount: 300000,
    principalPortion: null,
    dueDate: '2020-01-01',
    status: InstallmentStatus.Pending,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('findInstallmentsBreakdownByIds', () => {
  let findMock: jest.Mock;
  let installmentsRepository: Repository<Installment>;
  let paymentsFindMock: jest.Mock;
  let paymentsRepository: Repository<Payment>;
  let conceptsFindMock: jest.Mock;
  let loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>;

  beforeEach(() => {
    findMock = jest.fn();
    installmentsRepository = {
      find: findMock,
    } as unknown as Repository<Installment>;
    paymentsFindMock = jest.fn().mockResolvedValue([]);
    paymentsRepository = {
      find: paymentsFindMock,
    } as unknown as Repository<Payment>;
    // Bug fix, 2026-09-08 — see breakdownQueries.ts's own comment.
    conceptsFindMock = jest.fn().mockResolvedValue([]);
    loanInstallmentConceptsRepository = {
      find: conceptsFindMock,
    } as unknown as Repository<LoanInstallmentConcept>;
  });

  // Bug fix, 2026-09-03 (human report): backs the scoped "Más información"
  // reply — given the specific installment ids a reminder was about,
  // returns only those, enriched with their CURRENT live state.
  it('returns an empty array without querying when no ids are given', async () => {
    const result = await findInstallmentsBreakdownByIds(
      installmentsRepository,
      paymentsRepository,
      loanInstallmentConceptsRepository,
      [],
    );

    expect(result).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it('queries by the given installment ids and enriches them', async () => {
    findMock.mockResolvedValue([
      buildInstallment({ id: 'installment-1', installmentNumber: 3 }),
    ]);

    const result = await findInstallmentsBreakdownByIds(
      installmentsRepository,
      paymentsRepository,
      loanInstallmentConceptsRepository,
      ['installment-1'],
    );

    expect(findMock).toHaveBeenCalledWith({
      where: { id: In(['installment-1']) },
      relations: { loan: true },
      order: { dueDate: 'ASC' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].installmentNumber).toBe(3);
    expect(result[0].promissoryNoteNumber).toBe('#743');
    expect(result[0].overdueDays).toBeGreaterThan(0);
  });

  // Bug fix, 2026-09-07 — see enrichInstallment.ts's `totalPaid` param.
  it('nets out an existing partial payment from totalDue', async () => {
    findMock.mockResolvedValue([
      buildInstallment({
        id: 'installment-1',
        amount: 300000,
        dueDate: '2099-01-01',
      }),
    ]);
    paymentsFindMock.mockResolvedValue([
      { installmentId: 'installment-1', amountPaid: 120000 },
    ]);

    const result = await findInstallmentsBreakdownByIds(
      installmentsRepository,
      paymentsRepository,
      loanInstallmentConceptsRepository,
      ['installment-1'],
    );

    expect(result[0].totalDue).toBe(180000);
  });

  // Bug fix, 2026-09-08 — before this, concepts was hardcoded to `[]`
  // here, so enrichInstallment always fell back to the legacy interestRate
  // formula. Every loan created since the Phase 23 redesign sends
  // interestRate: 0 (see buildInstallment's own fixture, and LoanForm.tsx's
  // comment), so this silently reported ZERO accrued mora in "Más
  // información" for a current-generation loan.
  it('uses the installment’s real moratory concepts instead of the legacy interestRate, even when interestRate is 0', async () => {
    findMock.mockResolvedValue([
      buildInstallment({
        id: 'installment-1',
        amount: 300000,
        dueDate: '2020-01-01',
      }),
    ]);
    conceptsFindMock.mockResolvedValue([
      {
        installmentId: 'installment-1',
        category: ConceptCategory.Moratorio,
        calculationType: ConceptCalculationType.Percentage,
        nameSnapshot: 'Intereses moratorios',
        value: 3,
      },
    ]);

    const result = await findInstallmentsBreakdownByIds(
      installmentsRepository,
      paymentsRepository,
      loanInstallmentConceptsRepository,
      ['installment-1'],
    );

    // With interestRate alone (the bug) this would be exactly 300000
    // (zero mora).
    expect(result[0].totalDue).toBeGreaterThan(300000);
  });
});
