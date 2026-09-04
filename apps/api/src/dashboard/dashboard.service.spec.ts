import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import {
  InstallmentFrequency,
  Loan,
  LoanStatus,
} from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';
import { MessageLog } from '../whatsapp/entities/messageLog.entity';

import { DashboardService } from './dashboard.service';
import { OverdueClientsSortBy } from './dto/queryOverdueClients.dto';

describe('DashboardService', () => {
  let service: DashboardService;
  let loansRepository: { find: jest.Mock; count: jest.Mock };
  let installmentsRepository: { find: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let messageLogsRepository: { count: jest.Mock };

  function makeClient(overrides: Partial<Client> = {}): Client {
    return {
      id: 'client-1',
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
      creditLimit: null,
      documentType: null,
      dateOfBirth: null,
      documentIssuePlace: null,
      email: null,
      alternatePhoneNumber: null,
      homeAddress: null,
      workAddress: null,
      neighborhood: null,
      city: null,
      occupation: null,
      employerName: null,
      monthlyIncome: null,
      idDocumentFrontUrl: null,
      idDocumentBackUrl: null,
      selfieImageUrl: null,
      dataProcessingConsent: false,
      consentGivenAt: null,
      consentDocumentUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  function makeLoan(client: Client, overrides: Partial<Loan> = {}): Loan {
    return {
      id: 'loan-1',
      clientId: client.id,
      client,
      promissoryNoteNumber: '#743',
      principalAmount: 900000,
      interestRate: 6,
      disbursedAt: '2026-01-01',
      installmentFrequency: InstallmentFrequency.Monthly,
      totalInstallments: 3,
      status: LoanStatus.Active,
      refinancedFromLoanId: null,
      refinancedFromLoan: null,
      description: null,
      newLoanMessageSentAt: null,
      coDebtorClientId: null,
      coDebtorClient: null,
      coDebtorRelationship: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  function makeInstallment(
    loan: Loan,
    overrides: Partial<Installment> = {},
  ): Installment {
    return {
      id: 'inst-1',
      loanId: loan.id,
      loan,
      installmentNumber: 1,
      amount: 210000,
      principalPortion: null,
      dueDate: '2024-01-01', // far in the past — deterministic overdue
      status: InstallmentStatus.Pending,
      isDownPayment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    loansRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    installmentsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    paymentsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    messageLogsRepository = { count: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  describe('getSummary', () => {
    it('returns the exact overdue count and total amount for a known set of installments', async () => {
      const client = makeClient();
      const loan = makeLoan(client, { interestRate: 6 });
      // amount 100000, rate 6%, 30 days overdue -> interest = 100000 * 0.06 / 30 * 30 = 6000
      const installmentA = makeInstallment(loan, {
        id: 'inst-a',
        amount: 100000,
        dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      });
      const installmentB = makeInstallment(loan, {
        id: 'inst-b',
        amount: 50000,
        dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      });
      installmentsRepository.find.mockResolvedValue([
        installmentA,
        installmentB,
      ]);
      loansRepository.find.mockResolvedValue([
        { clientId: 'client-1' },
        { clientId: 'client-2' },
        { clientId: 'client-3' },
        { clientId: 'client-4' },
      ]);
      messageLogsRepository.count.mockResolvedValue(7);

      const result = await service.getSummary();

      expect(result.totalActiveClients).toBe(4);
      expect(result.totalOverdueInstallments).toBe(2);
      // interest_a = 100000 * 0.06/30 * 30 = 6000 -> totalDue 106000
      // interest_b = 50000 * 0.06/30 * 10 = 1000 -> totalDue 51000
      expect(result.totalAmountOverdue).toBeCloseTo(157000, 5);
      expect(result.messagesSentThisWeek).toBe(7);
    });

    it('returns zeroes when there are no overdue installments', async () => {
      const result = await service.getSummary();

      expect(result.totalOverdueInstallments).toBe(0);
      expect(result.totalAmountOverdue).toBe(0);
    });
  });

  describe('getOverdueClients', () => {
    it('aggregates multiple overdue installments for the same client', async () => {
      const client = makeClient({ id: 'client-1' });
      const loan = makeLoan(client);
      const installmentA = makeInstallment(loan, {
        id: 'inst-a',
        amount: 100000,
        dueDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      });
      const installmentB = makeInstallment(loan, {
        id: 'inst-b',
        amount: 50000,
        dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      });
      installmentsRepository.find.mockResolvedValue([
        installmentA,
        installmentB,
      ]);

      const result = await service.getOverdueClients({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        clientId: 'client-1',
        overdueInstallmentsCount: 2,
        maxOverdueDays: 20,
      });
    });

    it('sorts by totalOverdueAmount descending by default', async () => {
      const smallClient = makeClient({ id: 'client-small' });
      const bigClient = makeClient({ id: 'client-big' });
      const smallLoan = makeLoan(smallClient, { id: 'loan-small' });
      const bigLoan = makeLoan(bigClient, { id: 'loan-big' });
      installmentsRepository.find.mockResolvedValue([
        makeInstallment(smallLoan, { id: 'inst-small', amount: 10000 }),
        makeInstallment(bigLoan, { id: 'inst-big', amount: 500000 }),
      ]);

      const result = await service.getOverdueClients({
        sortBy: OverdueClientsSortBy.TotalOverdueAmount,
      });

      expect(result.items.map((row) => row.clientId)).toEqual([
        'client-big',
        'client-small',
      ]);
    });

    it('sorts by maxOverdueDays descending when requested', async () => {
      const recentClient = makeClient({ id: 'client-recent' });
      const staleClient = makeClient({ id: 'client-stale' });
      const recentLoan = makeLoan(recentClient, { id: 'loan-recent' });
      const staleLoan = makeLoan(staleClient, { id: 'loan-stale' });
      installmentsRepository.find.mockResolvedValue([
        makeInstallment(recentLoan, {
          id: 'inst-recent',
          amount: 500000,
          dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
        }),
        makeInstallment(staleLoan, {
          id: 'inst-stale',
          amount: 10000,
          dueDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
        }),
      ]);

      const result = await service.getOverdueClients({
        sortBy: OverdueClientsSortBy.MaxOverdueDays,
      });

      expect(result.items.map((row) => row.clientId)).toEqual([
        'client-stale',
        'client-recent',
      ]);
    });

    it('paginates the aggregated rows', async () => {
      const clients = Array.from({ length: 3 }, (_, i) =>
        makeClient({ id: `client-${i}` }),
      );
      installmentsRepository.find.mockResolvedValue(
        clients.map((client, i) =>
          makeInstallment(makeLoan(client, { id: `loan-${i}` }), {
            id: `inst-${i}`,
          }),
        ),
      );

      const result = await service.getOverdueClients({ page: 2, limit: 2 });

      expect(result.items).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });
  });

  describe('getMonthlyReport', () => {
    it('scopes new loans and payments to the given month/year boundaries', async () => {
      loansRepository.count.mockResolvedValue(3);
      paymentsRepository.find.mockResolvedValue([
        { amountPaid: 300000 },
        { amountPaid: 150000 },
      ]);
      messageLogsRepository.count.mockResolvedValue(12);

      const result = await service.getMonthlyReport({ month: 7, year: 2026 });

      expect(loansRepository.count).toHaveBeenCalledWith({
        where: {
          disbursedAt: expect.objectContaining({
            _type: 'between',
            _value: ['2026-07-01', '2026-07-31'],
          }) as unknown,
        },
      });
      expect(paymentsRepository.find).toHaveBeenCalledWith({
        where: {
          paidAt: expect.objectContaining({
            _type: 'between',
            _value: ['2026-07-01', '2026-07-31'],
          }) as unknown,
        },
        select: { amountPaid: true },
      });
      expect(result).toEqual({
        month: 7,
        year: 2026,
        newLoansDisbursed: 3,
        totalPaymentsReceived: 450000,
        messagesSent: 12,
      });
    });

    it('scopes a 28-day February correctly', async () => {
      await service.getMonthlyReport({ month: 2, year: 2026 });

      expect(paymentsRepository.find).toHaveBeenCalledWith({
        where: {
          paidAt: expect.objectContaining({
            _type: 'between',
            _value: ['2026-02-01', '2026-02-28'],
          }) as unknown,
        },
        select: { amountPaid: true },
      });
    });
  });
});
