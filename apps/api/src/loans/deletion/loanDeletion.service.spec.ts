import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOperator } from 'typeorm';

import { ClientCreditBalanceService } from '../../clients/clientCreditBalance.service';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '../../interestConceptTypes/entities/interestConceptType.entity';
import { Installment, InstallmentStatus } from '../entities/installment.entity';
import {
  InstallmentFrequency,
  Loan,
  LoanStatus,
} from '../entities/loan.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';
import { Payment } from '../entities/payment.entity';

import { LoanDeletionService } from './loanDeletion.service';

type Where = Record<string, unknown>;

// `In([...])` arrives as a FindOperator; a plain value as itself.
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) =>
    expected instanceof FindOperator
      ? (expected.value as unknown[]).includes(row[key])
      : row[key] === expected,
  );
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan-1',
    clientId: 'client-1',
    client: { firstName: 'Juana', lastName: 'Pérez' } as never,
    promissoryNoteNumber: '#0800',
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
    deletedAt: null,
    deletedByUserId: null,
    deletedByUser: null,
    deletionReason: null,
    deletionSnapshot: null,
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: 'inst-1',
    loanId: 'loan-1',
    loan: undefined as never,
    installmentNumber: 1,
    amount: 300000,
    principalPortion: 270000,
    dueDate: '2099-01-01',
    status: InstallmentStatus.Pending,
    isDownPayment: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    installmentId: 'inst-1',
    installment: undefined as never,
    amountPaid: 300000,
    paidAt: '2026-02-01',
    observation: null,
    imageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    voidReason: null,
    moraWaivedAmount: 0,
    moraWaiverReason: null,
    fundedByCredit: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('LoanDeletionService', () => {
  let service: LoanDeletionService;
  let loans: Loan[];
  let installments: Installment[];
  let payments: Payment[];
  let concepts: LoanInstallmentConcept[];
  let loansRepository: Record<string, jest.Mock>;
  let installmentsRepository: Record<string, jest.Mock>;
  let paymentsRepository: Record<string, jest.Mock>;
  let conceptsRepository: Record<string, jest.Mock>;
  let creditService: Record<string, jest.Mock>;
  let dataSource: { manager: EntityManager; transaction: jest.Mock };

  beforeEach(async () => {
    loans = [makeLoan()];
    installments = [makeInstallment()];
    payments = [];
    concepts = [];

    loansRepository = {
      findOne: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          loans.find((loan) => matches({ ...loan }, where)) ?? null,
        ),
      ),
      findOneBy: jest.fn((where: Where) =>
        Promise.resolve(
          loans.find((loan) => matches({ ...loan }, where)) ?? null,
        ),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    installmentsRepository = {
      find: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          installments.filter((row) => matches({ ...row }, where)),
        ),
      ),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    paymentsRepository = {
      find: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(payments.filter((row) => matches({ ...row }, where))),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    conceptsRepository = {
      find: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(concepts.filter((row) => matches({ ...row }, where))),
      ),
    };
    creditService = {
      summarizeCreditByPaymentId: jest.fn().mockResolvedValue(new Map()),
      getBalance: jest.fn().mockResolvedValue(0),
      findCreditDrawsOutside: jest.fn().mockResolvedValue([]),
      restoreCreditSpentBy: jest.fn().mockResolvedValue(undefined),
      reverseCreditGeneratedBy: jest.fn().mockResolvedValue(undefined),
    };

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Loan) return loansRepository;
        if (entity === Installment) return installmentsRepository;
        if (entity === Payment) return paymentsRepository;
        if (entity === LoanInstallmentConcept) return conceptsRepository;
        throw new Error(`No mock repository for ${String(entity)}`);
      },
    } as unknown as EntityManager;
    dataSource = {
      manager,
      transaction: jest.fn(
        (work: (transactionManager: EntityManager) => Promise<unknown>) =>
          work(manager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanDeletionService,
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        { provide: ClientCreditBalanceService, useValue: creditService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(LoanDeletionService);
  });

  describe('preview', () => {
    it('summarizes an active loan with nothing blocking it', async () => {
      payments = [makePayment({ amountPaid: 120000 })];

      const preview = await service.preview('loan-1');

      expect(preview).toEqual(
        expect.objectContaining({
          promissoryNoteNumber: '#0800',
          clientFullName: 'Juana Pérez',
          chainLoans: [],
          installmentCount: 1,
          paymentCount: 1,
          paymentsTotal: 120000,
          blockers: [],
        }),
      );
    });

    it('blocks a paid loan', async () => {
      loans = [makeLoan({ status: LoanStatus.Paid })];

      const preview = await service.preview('loan-1');

      expect(preview.blockers).toEqual([
        'Solo se puede eliminar un pagaré activo. Este pagaré está pagado.',
      ]);
    });

    it('blocks a refinanced loan and names the pagaré that replaced it', async () => {
      loans = [
        makeLoan({ id: 'old', status: LoanStatus.Refinanced }),
        makeLoan({
          id: 'new',
          refinancedFromLoanId: 'old',
          promissoryNoteNumber: '#0900',
        }),
      ];

      const preview = await service.preview('old');

      expect(preview.blockers[0]).toContain(
        'se elimina junto con el pagaré que lo reemplazó (#0900)',
      );
    });

    it('takes the whole refinance chain behind an active loan', async () => {
      loans = [
        makeLoan({
          id: 'oldest',
          status: LoanStatus.Refinanced,
          promissoryNoteNumber: '#0500',
        }),
        makeLoan({
          id: 'middle',
          status: LoanStatus.Refinanced,
          refinancedFromLoanId: 'oldest',
        }),
        makeLoan({ id: 'head', refinancedFromLoanId: 'middle' }),
      ];
      installments = [
        makeInstallment({
          id: 'a',
          loanId: 'oldest',
          status: InstallmentStatus.Cancelled,
        }),
        makeInstallment({
          id: 'b',
          loanId: 'middle',
          status: InstallmentStatus.Cancelled,
        }),
        makeInstallment({ id: 'c', loanId: 'head' }),
      ];

      const preview = await service.preview('head');

      expect(preview.chainLoans).toEqual([
        { id: 'middle', promissoryNoteNumber: '#0800' },
        { id: 'oldest', promissoryNoteNumber: '#0500' },
      ]);
      expect(preview.installmentCount).toBe(3);
      expect(preview.blockers).toEqual([]);
    });

    it('reports the saldo a favor it would give back and take back', async () => {
      payments = [makePayment({ id: 'funded' }), makePayment({ id: 'excess' })];
      creditService.summarizeCreditByPaymentId.mockResolvedValue(
        new Map([
          ['funded', { generated: 0, spent: 50000 }],
          ['excess', { generated: 30000, spent: 0 }],
        ]),
      );

      const preview = await service.preview('loan-1');

      expect(preview.creditToRestore).toBe(50000);
      expect(preview.creditToReverse).toBe(30000);
      // 0 available + 50.000 restored covers the 30.000 taken back.
      expect(preview.blockers).toEqual([]);
    });

    it('blocks when the credit it generated was already spent elsewhere, naming where', async () => {
      payments = [makePayment({ id: 'excess' })];
      creditService.summarizeCreditByPaymentId.mockResolvedValue(
        new Map([['excess', { generated: 100000, spent: 0 }]]),
      );
      creditService.getBalance.mockResolvedValue(0);
      creditService.findCreditDrawsOutside.mockResolvedValue([
        {
          type: 'applied',
          amount: 100000,
          resultingPaymentId: 'real-payment',
          createdAt: new Date(),
        },
      ]);
      paymentsRepository.find.mockImplementation(
        ({ where }: { where: Where }) =>
          Promise.resolve(
            'id' in where
              ? [
                  makePayment({
                    id: 'real-payment',
                    installment: {
                      installmentNumber: 3,
                      loan: { promissoryNoteNumber: '#0700' },
                    } as never,
                  }),
                ]
              : payments,
          ),
      );

      const preview = await service.preview('loan-1');

      expect(preview.blockers).toHaveLength(1);
      expect(preview.blockers[0]).toContain('cuota 3 del pagaré #0700');
      expect(creditService.findCreditDrawsOutside).toHaveBeenCalledWith(
        'client-1',
        ['excess'],
      );
    });

    it('throws NotFoundException for a loan that does not exist', async () => {
      await expect(service.preview('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    const dto = {
      reason: 'Pagaré de prueba',
      confirmPromissoryNoteNumber: '#0800',
    };

    it('voids every payment, freezes the cuotas and soft-deletes the loan', async () => {
      payments = [makePayment({ id: 'pay-1' }), makePayment({ id: 'pay-2' })];

      await service.delete('loan-1', dto, 'admin-1');

      expect(paymentsRepository.update).toHaveBeenCalledWith(
        { id: expect.any(FindOperator) as unknown },
        {
          deletedAt: expect.any(Date) as unknown,
          voidReason: 'Pagaré eliminado: Pagaré de prueba',
        },
      );
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: 'loan-1' },
        expect.objectContaining({
          deletedByUserId: 'admin-1',
          deletionReason: 'Pagaré de prueba',
          deletionSnapshot: expect.objectContaining({
            installments: [expect.objectContaining({ installmentNumber: 1 })],
          }) as unknown,
        }),
      );
      expect(installmentsRepository.softDelete).toHaveBeenCalled();
      expect(loansRepository.softDelete).toHaveBeenCalled();
    });

    it('restores credit for every payment before reversing any', async () => {
      payments = [makePayment({ id: 'pay-1' }), makePayment({ id: 'pay-2' })];

      await service.delete('loan-1', dto, 'admin-1');

      const lastRestore = Math.max(
        ...creditService.restoreCreditSpentBy.mock.invocationCallOrder,
      );
      const firstReverse = Math.min(
        ...creditService.reverseCreditGeneratedBy.mock.invocationCallOrder,
      );
      expect(creditService.restoreCreditSpentBy).toHaveBeenCalledTimes(2);
      expect(lastRestore).toBeLessThan(firstReverse);
    });

    it('freezes the mora an overdue cuota had at that moment', async () => {
      installments = [makeInstallment({ dueDate: '2026-01-01' })];
      concepts = [
        {
          id: 'concept-1',
          installmentId: 'inst-1',
          nameSnapshot: 'Intereses moratorios',
          calculationType: ConceptCalculationType.Percentage,
          category: ConceptCategory.Moratorio,
          value: 2,
          computedAmount: 0,
        } as LoanInstallmentConcept,
      ];

      await service.delete('loan-1', dto, 'admin-1');

      const [[, fields]] = loansRepository.update.mock.calls as [
        [unknown, Pick<Loan, 'deletionSnapshot'>],
      ];
      const snapshot = fields.deletionSnapshot!;
      expect(snapshot.installments[0].overdueDays).toBeGreaterThan(0);
      expect(snapshot.installments[0].interest).toBeGreaterThan(0);
    });

    it('deletes every loan of the chain, reviving none', async () => {
      loans = [
        makeLoan({ id: 'old', status: LoanStatus.Refinanced }),
        makeLoan({ id: 'new', refinancedFromLoanId: 'old' }),
      ];
      installments = [
        makeInstallment({
          id: 'a',
          loanId: 'old',
          status: InstallmentStatus.Cancelled,
        }),
        makeInstallment({ id: 'b', loanId: 'new' }),
      ];

      await service.delete('new', dto, 'admin-1');

      expect(loansRepository.update).toHaveBeenCalledTimes(2);
      const [[criteria]] = loansRepository.softDelete.mock.calls as [
        [{ id: FindOperator<string[]> }],
      ];
      const deletedIds = criteria.id.value;
      expect(deletedIds).toEqual(['new', 'old']);
      // Nothing ever flips the old loan back to active.
      expect(loansRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: LoanStatus.Active }),
      );
    });

    it('accepts the current number of a renumbered loan, with or without #', async () => {
      loans = [makeLoan({ promissoryNoteNumber: '743' })];

      await service.delete(
        'loan-1',
        { ...dto, confirmPromissoryNoteNumber: ' #743 ' },
        'admin-1',
      );

      expect(loansRepository.softDelete).toHaveBeenCalled();
    });

    it('rejects a number that is not the current one, deleting nothing', async () => {
      loans = [makeLoan({ promissoryNoteNumber: '#1201' })];

      await expect(
        service.delete(
          'loan-1',
          { ...dto, confirmPromissoryNoteNumber: '#1200' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.delete(
          'loan-1',
          { ...dto, confirmPromissoryNoteNumber: '#1200' },
          'admin-1',
        ),
      ).rejects.toThrow('#1201');
      expect(loansRepository.update).not.toHaveBeenCalled();
      expect(loansRepository.softDelete).not.toHaveBeenCalled();
    });

    it('rejects a loan with a blocker, deleting nothing', async () => {
      loans = [makeLoan({ status: LoanStatus.Paid })];

      await expect(service.delete('loan-1', dto, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(paymentsRepository.update).not.toHaveBeenCalled();
      expect(loansRepository.softDelete).not.toHaveBeenCalled();
    });

    it('runs inside one transaction', async () => {
      await service.delete('loan-1', dto, 'admin-1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for a loan that does not exist', async () => {
      await expect(service.delete('missing', dto, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
