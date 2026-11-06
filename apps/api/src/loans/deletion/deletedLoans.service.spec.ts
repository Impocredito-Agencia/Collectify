import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';

import { Installment, InstallmentStatus } from '../entities/installment.entity';
import {
  InstallmentFrequency,
  Loan,
  LoanStatus,
} from '../entities/loan.entity';
import { Payment } from '../entities/payment.entity';
import { LoansService } from '../loans.service';

import { DeletedLoansService } from './deletedLoans.service';

type Where = Record<string, unknown>;

// Plain values compared directly; In([...]) checked by membership; any
// other operator (Not(IsNull())) is the "is deleted" filter.
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (!(expected instanceof FindOperator)) {
      return row[key] === expected;
    }
    if (expected.type === 'in') {
      return (expected.value as unknown[]).includes(row[key]);
    }
    return row[key] !== null && row[key] !== undefined;
  });
}

function makeDeletedLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan-1',
    clientId: 'client-1',
    client: {
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
    } as never,
    promissoryNoteNumber: '#9999',
    principalAmount: 600000,
    disbursedAt: '2026-01-01',
    installmentFrequency: InstallmentFrequency.Monthly,
    totalInstallments: 2,
    status: LoanStatus.Active,
    refinancedFromLoanId: null,
    refinancedFromLoan: null,
    refinanceMoraWaivedAmount: 0,
    refinanceMoraWaiverReason: null,
    description: null,
    newLoanMessageSentAt: null,
    isNewLoan: false,
    coDebtorClientId: null,
    coDebtorClient: null,
    coDebtorRelationship: null,
    alternateContactName: null,
    alternateContactPhoneNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: new Date('2026-11-05T15:00:00Z'),
    deletedByUserId: 'admin-1',
    deletedByUser: { fullName: 'Ana Admin' } as never,
    deletionReason: 'Pagaré de prueba',
    deletionSnapshot: null,
    ...overrides,
  };
}

describe('DeletedLoansService', () => {
  let service: DeletedLoansService;
  let loans: Loan[];
  let installments: Partial<Installment>[];
  let payments: Partial<Payment>[];
  let loansService: { getDeletedLoanPayments: jest.Mock };

  beforeEach(async () => {
    loans = [makeDeletedLoan()];
    installments = [];
    payments = [];
    loansService = { getDeletedLoanPayments: jest.fn().mockResolvedValue([]) };

    const filter =
      <T>(rows: () => T[]) =>
      ({ where }: { where: Where }) =>
        Promise.resolve(
          rows().filter((row) => matches({ ...row } as Where, where)),
        );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeletedLoansService,
        {
          provide: getRepositoryToken(Loan),
          useValue: {
            find: jest.fn(filter(() => loans)),
            findOne: jest.fn(({ where }: { where: Where }) =>
              filter(() => loans)({ where }).then((rows) => rows[0] ?? null),
            ),
          },
        },
        {
          provide: getRepositoryToken(Installment),
          useValue: { find: jest.fn(filter(() => installments)) },
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: { find: jest.fn(filter(() => payments)) },
        },
        { provide: LoansService, useValue: loansService },
      ],
    }).compile();

    service = module.get(DeletedLoansService);
  });

  describe('findAll', () => {
    it('lists deleted loans with who deleted them, why, and whether they had payments', async () => {
      loans = [
        makeDeletedLoan({ id: 'with-payments' }),
        makeDeletedLoan({ id: 'without', promissoryNoteNumber: '#9998' }),
      ];
      installments = [
        { id: 'inst-1', loanId: 'with-payments' },
        { id: 'inst-2', loanId: 'without' },
      ];
      payments = [{ installmentId: 'inst-1' }];

      const result = await service.findAll({});

      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'with-payments',
          clientFullName: 'Juana Pérez',
          principalAmount: 600000,
          totalInstallments: 2,
          deletedByFullName: 'Ana Admin',
          deletionReason: 'Pagaré de prueba',
          hadPayments: true,
        }),
        expect.objectContaining({ id: 'without', hadPayments: false }),
      ]);
      expect(result.meta.total).toBe(2);
    });

    it('filters by client and by search text', async () => {
      loans = [
        makeDeletedLoan({ id: 'a', clientId: 'client-1' }),
        makeDeletedLoan({
          id: 'b',
          clientId: 'client-2',
          promissoryNoteNumber: '#0801',
        }),
      ];

      const byClient = await service.findAll({ clientId: 'client-2' });
      const bySearch = await service.findAll({ search: '0801' });

      expect(byClient.items.map((item) => item.id)).toEqual(['b']);
      expect(bySearch.items.map((item) => item.id)).toEqual(['b']);
    });

    it('shows a deleted refinance chain as one row: its head, with the earlier loans attached', async () => {
      loans = [
        makeDeletedLoan({
          id: 'head',
          promissoryNoteNumber: '#0006',
          refinancedFromLoanId: 'middle',
        }),
        makeDeletedLoan({
          id: 'middle',
          promissoryNoteNumber: '#0006',
          status: LoanStatus.Refinanced,
          refinancedFromLoanId: 'first',
        }),
        makeDeletedLoan({
          id: 'first',
          promissoryNoteNumber: '#0004',
          status: LoanStatus.Refinanced,
        }),
        makeDeletedLoan({ id: 'alone', promissoryNoteNumber: '#9998' }),
      ];
      // Only the first loan of the chain had a payment.
      installments = [{ id: 'inst-1', loanId: 'first' }];
      payments = [{ installmentId: 'inst-1' }];

      const result = await service.findAll({});

      expect(result.items.map((item) => item.id)).toEqual(['head', 'alone']);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          hadPayments: true,
          refinancedLoans: [
            { id: 'middle', promissoryNoteNumber: '#0006' },
            { id: 'first', promissoryNoteNumber: '#0004' },
          ],
        }),
      );
      expect(result.items[1]).toEqual(
        expect.objectContaining({ hadPayments: false, refinancedLoans: [] }),
      );
      expect(result.meta.total).toBe(2);
    });

    it('finds a chain by the number of one of its earlier loans', async () => {
      loans = [
        makeDeletedLoan({ id: 'head', refinancedFromLoanId: 'first' }),
        makeDeletedLoan({
          id: 'first',
          promissoryNoteNumber: '#0004',
          status: LoanStatus.Refinanced,
        }),
      ];

      const result = await service.findAll({ search: '0004' });

      expect(result.items.map((item) => item.id)).toEqual(['head']);
    });

    it('shows a pre-Phase 35 deletion with no reason and no author', async () => {
      loans = [
        makeDeletedLoan({
          deletedByUserId: null,
          deletedByUser: null,
          deletionReason: null,
        }),
      ];

      const result = await service.findAll({});

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          deletedByFullName: null,
          deletionReason: null,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the frozen cuotas when a snapshot exists', async () => {
      const frozen = {
        installmentNumber: 1,
        isDownPayment: false,
        dueDate: '2026-01-01',
        amount: 300000,
        principalPortion: 270000,
        status: InstallmentStatus.Pending,
        overdueDays: 40,
        interest: 8600,
        totalPaid: 0,
        totalDue: 308600,
        conceptBreakdown: [],
      };
      loans = [
        makeDeletedLoan({
          deletionSnapshot: {
            takenAt: '2026-11-05T15:00:00.000Z',
            installments: [frozen],
          },
        }),
      ];

      const detail = await service.findOne('loan-1');

      expect(detail.installments).toEqual([frozen]);
      expect(detail.hasFrozenFigures).toBe(true);
      expect(detail.clientDocumentNumber).toBe('1234567890');
    });

    it('rebuilds cuotas without mora for a loan deleted before Phase 35', async () => {
      installments = [
        {
          id: 'inst-1',
          loanId: 'loan-1',
          installmentNumber: 1,
          isDownPayment: false,
          dueDate: '2026-01-01',
          amount: 300000,
          principalPortion: 270000,
          status: InstallmentStatus.Pending,
        },
      ];

      const detail = await service.findOne('loan-1');

      expect(detail.hasFrozenFigures).toBe(false);
      expect(detail.installments[0]).toEqual(
        expect.objectContaining({
          amount: 300000,
          overdueDays: 0,
          interest: 0,
        }),
      );
    });

    it('includes its voided payments and the chain deleted with it', async () => {
      loans = [
        makeDeletedLoan({ id: 'old', status: LoanStatus.Refinanced }),
        makeDeletedLoan({ id: 'loan-1', refinancedFromLoanId: 'old' }),
      ];
      loansService.getDeletedLoanPayments.mockResolvedValue([
        { id: 'pay-1', voidReason: 'Pagaré eliminado: Pagaré de prueba' },
      ]);

      const detail = await service.findOne('loan-1');

      expect(detail.payments).toHaveLength(1);
      expect(detail.hadPayments).toBe(true);
      expect(detail.deletedTogether).toEqual([
        { id: 'old', promissoryNoteNumber: '#9999' },
      ]);
      expect(detail.refinancedLoans).toEqual([
        { id: 'old', promissoryNoteNumber: '#9999' },
      ]);
    });

    it('throws NotFoundException for a loan that is not deleted', async () => {
      loans = [makeDeletedLoan({ deletedAt: null })];

      await expect(service.findOne('loan-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
