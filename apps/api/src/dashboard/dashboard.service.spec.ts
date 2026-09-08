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
import {
  MessageLog,
  MessageLogStatus,
} from '../whatsapp/entities/messageLog.entity';

import { DashboardService } from './dashboard.service';
import { OverdueClientsSortBy } from './dto/queryOverdueClients.dto';

describe('DashboardService', () => {
  let service: DashboardService;
  let loansRepository: { find: jest.Mock; count: jest.Mock };
  let installmentsRepository: { find: jest.Mock; count: jest.Mock };
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
      isNewLoan: false,
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

  // Bug fix, 2026-09-06 — several tests below build a `dueDate` fixture by
  // subtracting N days from the real `Date.now()` and slicing to a UTC
  // calendar-date string, then assert an exact overdueDays/interest result.
  // That's only safe when "now" and "now minus N days" share the same UTC
  // calendar day as their Bogotá calendar day — true most of the day, but
  // false during UTC 00:00-05:00 (7pm-midnight in Bogotá), when the two
  // diverge by one (see dueDateSchedule.ts's todayDateString() comment for
  // the root cause). This exposed a REAL bug, not just a test-timing
  // artifact: dashboard.service.ts's own gatherOverdueInstallments/
  // countUpcomingDueInstallments built their `today`/`windowEnd` query
  // bounds from the same raw, un-adjusted UTC date, inconsistent with
  // enrichInstallment's Bogotá-aware overdueDays calculation used right
  // next to them — now fixed there too, via todayDateString()/
  // addDaysToDateString(). Pinning the clock to noon UTC (7am Bogotá,
  // safely mid-day on both sides) for the whole suite makes every "N days
  // ago" fixture below land on the same calendar day in UTC and in
  // Bogotá, regardless of when the suite actually runs — same fix pattern
  // as installmentCalculations.spec.ts's bogotaNoon() — independent of,
  // and on top of, the production fix above.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    loansRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    installmentsRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
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
      // 5 active loans across 4 clients — one client has two active loans,
      // which is exactly why totalActiveLoans and totalActiveClients differ.
      loansRepository.count.mockResolvedValue(5);
      installmentsRepository.count.mockResolvedValue(3);
      // Distinguishes the two countMessagesXThisWeek() calls, which both
      // hit this same mocked repository.count — matches on the `status`
      // filter each one passes rather than call order.
      messageLogsRepository.count.mockImplementation(
        (options?: { where?: { status?: MessageLogStatus } }) =>
          Promise.resolve(
            options?.where?.status === MessageLogStatus.Failed ? 2 : 7,
          ),
      );

      const result = await service.getSummary();

      expect(result.totalActiveClients).toBe(4);
      expect(result.totalActiveLoans).toBe(5);
      expect(loansRepository.count).toHaveBeenCalledWith({
        where: { status: LoanStatus.Active },
      });
      expect(result.totalOverdueInstallments).toBe(2);
      expect(result.upcomingDueInstallments).toBe(3);
      // interest_a = 100000 * 0.06/30 * 30 = 6000 -> totalDue 106000
      // interest_b = 50000 * 0.06/30 * 10 = 1000 -> totalDue 51000
      expect(result.totalAmountOverdue).toBeCloseTo(157000, 5);
      // Same installmentsRepository.find mock backs both the overdue fetch
      // and sumOutstandingPrincipal's fetch (this repo mock doesn't
      // distinguish by query) — both installments have a null
      // principalPortion, so this is amount_a + amount_b = 150000.
      expect(result.totalOutstandingPrincipal).toBe(150000);
      // 157000 / 150000 * 100 = 104.666...% -> rounded to 1 decimal.
      expect(result.overdueRate).toBeCloseTo(104.7, 5);
      expect(result.messagesSentThisWeek).toBe(7);
      expect(result.messagesFailedThisWeek).toBe(2);
    });

    // Bug fix, 2026-09-07 — before this, totalAmountOverdue never netted
    // out a partial payment already made on an overdue installment, so the
    // Dashboard's "cuotas vencidas" total stayed as high as if that money
    // had never come in.
    it('nets out an existing partial payment from totalAmountOverdue', async () => {
      const client = makeClient();
      const loan = makeLoan(client, { interestRate: 6 });
      const installmentA = makeInstallment(loan, {
        id: 'inst-a',
        amount: 100000,
        dueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      });
      installmentsRepository.find.mockResolvedValue([installmentA]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-a', amountPaid: 40000 },
      ]);

      const result = await service.getSummary();

      // totalDue would be 106000 (see the test above) without the payment;
      // netting out the 40000 already paid leaves 66000.
      expect(result.totalAmountOverdue).toBeCloseTo(66000, 5);
    });

    it('returns zeroes when there are no overdue installments', async () => {
      const result = await service.getSummary();

      expect(result.totalOverdueInstallments).toBe(0);
      expect(result.totalAmountOverdue).toBe(0);
      expect(result.totalActiveLoans).toBe(0);
      expect(result.totalOutstandingPrincipal).toBe(0);
      // Division-by-zero guard: no active portfolio means 0%, not NaN.
      expect(result.overdueRate).toBe(0);
      expect(result.messagesFailedThisWeek).toBe(0);
      expect(result.upcomingDueInstallments).toBe(0);
    });

    it('queries upcomingDueInstallments as a [today, today+5] window, not the overdue LessThan(today) filter', async () => {
      installmentsRepository.count.mockResolvedValue(4);

      const result = await service.getSummary();

      expect(result.upcomingDueInstallments).toBe(4);
      const today = new Date().toISOString().slice(0, 10);
      const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      expect(installmentsRepository.count).toHaveBeenCalledWith({
        where: {
          status: InstallmentStatus.Pending,
          dueDate: expect.objectContaining({
            _type: 'between',
            _value: [today, in5Days],
          }) as unknown,
          loan: { status: LoanStatus.Active },
        },
      });
    });

    // Regression test, 2026-09-06 — gatherOverdueInstallments/
    // countUpcomingDueInstallments used to build `today`/`windowEnd` from
    // raw `new Date().toISOString().slice(0, 10)` (the UTC calendar date)
    // instead of the Bogotá-aware todayDateString()/addDaysToDateString().
    // 2026-06-16T04:59:59Z is 11:59:59pm on June 15 in Bogotá (UTC-5) —
    // still June 15 there, even though UTC's own calendar date is already
    // June 16. Pins the clock right on that boundary so a regression back
    // to the raw-UTC bug is caught directly, independent of whatever real
    // instant the suite happens to run at.
    it('uses the Bogotá calendar date, not raw UTC, for the overdue and upcoming-due query bounds', async () => {
      jest.setSystemTime(new Date('2026-06-16T04:59:59Z'));
      installmentsRepository.count.mockResolvedValue(0);

      await service.getSummary();

      expect(installmentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dueDate: expect.objectContaining({
              _type: 'lessThan',
              _value: '2026-06-15',
            }) as unknown,
          }) as unknown,
        }),
      );
      expect(installmentsRepository.count).toHaveBeenCalledWith({
        where: {
          status: InstallmentStatus.Pending,
          dueDate: expect.objectContaining({
            _type: 'between',
            _value: ['2026-06-15', '2026-06-20'],
          }) as unknown,
          loan: { status: LoanStatus.Active },
        },
      });
    });

    it('falls back to the installment amount when principalPortion is null, for outstanding principal', async () => {
      const client = makeClient();
      const loan = makeLoan(client);
      const withPortion = makeInstallment(loan, {
        id: 'inst-portion',
        amount: 120000,
        principalPortion: 80000,
        dueDate: '2099-01-01', // not overdue — outstanding principal counts it anyway
      });
      const legacyNoPortion = makeInstallment(loan, {
        id: 'inst-legacy',
        amount: 90000,
        principalPortion: null,
        dueDate: '2099-01-01',
      });
      installmentsRepository.find.mockResolvedValue([
        withPortion,
        legacyNoPortion,
      ]);

      const result = await service.getSummary();

      // 80000 (its own principalPortion) + 90000 (falls back to amount).
      expect(result.totalOutstandingPrincipal).toBe(170000);
      expect(installmentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: InstallmentStatus.Pending,
            loan: { status: LoanStatus.Active },
          }) as unknown,
        }),
      );
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
