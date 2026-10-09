import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, LessThanOrEqual } from 'typeorm';

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

import { ClientBreakdownService } from './clientBreakdown.service';

describe('ClientBreakdownService', () => {
  let service: ClientBreakdownService;
  let installmentsRepository: { find: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let conceptsRepository: { find: jest.Mock };

  const TODAY = '2026-10-09';

  const loan = (overrides: Partial<Loan> = {}): Loan =>
    ({
      id: 'loan-1',
      clientId: 'client-1',
      promissoryNoteNumber: '#1223',
      disbursedAt: '2026-06-01',
      status: LoanStatus.Active,
      ...overrides,
    }) as Loan;

  const installment = (overrides: Partial<Installment> = {}): Installment =>
    ({
      id: 'inst-1',
      loanId: 'loan-1',
      loan: loan(),
      installmentNumber: 3,
      amount: 100000,
      dueDate: '2026-09-01',
      status: InstallmentStatus.Pending,
      ...overrides,
    }) as Installment;

  // 2% monthly moratory interest: $100.000 × 2% / 30 per day overdue.
  const moratoryConcept = (installmentId: string): LoanInstallmentConcept =>
    ({
      installmentId,
      nameSnapshot: 'Intereses moratorios',
      category: ConceptCategory.Moratorio,
      calculationType: ConceptCalculationType.Percentage,
      value: 2,
      computedAmount: 0,
    }) as LoanInstallmentConcept;

  beforeEach(async () => {
    installmentsRepository = { find: jest.fn().mockResolvedValue([]) };
    paymentsRepository = { find: jest.fn().mockResolvedValue([]) };
    conceptsRepository = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientBreakdownService,
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: conceptsRepository,
        },
      ],
    }).compile();

    service = module.get(ClientBreakdownService);
  });

  it("only looks at the client's pending installments on active loans", async () => {
    await service.getBreakdownAsOf('client-1', '2026-10-01', TODAY);

    expect(installmentsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: InstallmentStatus.Pending,
          loan: { clientId: 'client-1', status: LoanStatus.Active },
        },
      }),
    );
  });

  it('values mora with the overdue days of the requested day, not today', async () => {
    installmentsRepository.find.mockResolvedValue([installment()]);
    conceptsRepository.find.mockResolvedValue([moratoryConcept('inst-1')]);

    const result = await service.getBreakdownAsOf(
      'client-1',
      '2026-09-21',
      TODAY,
    );

    // 20 days overdue on 2026-09-21 → 100.000 × 2% / 30 × 20 = 1.333,
    // total rounded to the nearest $100.
    expect(result.installments).toEqual([
      {
        installmentId: 'inst-1',
        loanId: 'loan-1',
        promissoryNoteNumber: '#1223',
        installmentNumber: 3,
        dueDate: '2026-09-01',
        amount: 100000,
        interest: 1333,
        paidByDate: 0,
        totalDue: 101300,
        overdueDays: 20,
        daysUntilDue: 0,
      },
    ]);
    expect(result.date).toBe('2026-09-21');
    expect(result.totalPayableOnDate).toBe(101300);
  });

  it('charges no mora while the requested day is inside the grace period', async () => {
    installmentsRepository.find.mockResolvedValue([installment()]);
    conceptsRepository.find.mockResolvedValue([moratoryConcept('inst-1')]);

    const result = await service.getBreakdownAsOf(
      'client-1',
      '2026-09-07',
      TODAY,
    );

    expect(result.installments[0]).toMatchObject({
      overdueDays: 6,
      interest: 0,
      totalDue: 100000,
    });
  });

  it('shows a cuota that was not yet due that day as upcoming and leaves it out of the payable total', async () => {
    installmentsRepository.find.mockResolvedValue([
      installment(),
      installment({
        id: 'inst-2',
        installmentNumber: 4,
        dueDate: '2026-10-01',
      }),
    ]);
    conceptsRepository.find.mockResolvedValue([
      moratoryConcept('inst-1'),
      moratoryConcept('inst-2'),
    ]);

    const result = await service.getBreakdownAsOf(
      'client-1',
      '2026-09-21',
      TODAY,
    );

    expect(result.installments[1]).toMatchObject({
      installmentId: 'inst-2',
      overdueDays: 0,
      daysUntilDue: 10,
      interest: 0,
      totalDue: 100000,
    });
    expect(result.totalPayableOnDate).toBe(101300);
  });

  it('counts a cuota due exactly that day as payable', async () => {
    installmentsRepository.find.mockResolvedValue([
      installment({ dueDate: '2026-09-21' }),
    ]);

    const result = await service.getBreakdownAsOf(
      'client-1',
      '2026-09-21',
      TODAY,
    );

    expect(result.installments[0]).toMatchObject({
      overdueDays: 0,
      daysUntilDue: 0,
    });
    expect(result.totalPayableOnDate).toBe(100000);
  });

  it('nets out only the abonos dated on or before the requested day', async () => {
    installmentsRepository.find.mockResolvedValue([installment()]);
    conceptsRepository.find.mockResolvedValue([moratoryConcept('inst-1')]);
    paymentsRepository.find.mockResolvedValue([
      { installmentId: 'inst-1', amountPaid: 40000, moraWaivedAmount: 0 },
    ]);

    const result = await service.getBreakdownAsOf(
      'client-1',
      '2026-09-21',
      TODAY,
    );

    expect(paymentsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          installmentId: In(['inst-1']),
          paidAt: LessThanOrEqual('2026-09-21'),
        },
      }),
    );
    expect(result.installments[0]).toMatchObject({
      paidByDate: 40000,
      totalDue: 61300,
    });
  });

  it('leaves out a pagaré disbursed after the requested day', async () => {
    installmentsRepository.find.mockResolvedValue([
      installment(),
      installment({
        id: 'inst-new',
        loanId: 'loan-2',
        loan: loan({ id: 'loan-2', disbursedAt: '2026-09-25' }),
      }),
    ]);

    const result = await service.getBreakdownAsOf(
      'client-1',
      '2026-09-21',
      TODAY,
    );

    expect(result.installments.map((item) => item.installmentId)).toEqual([
      'inst-1',
    ]);
  });

  it('accepts today itself', async () => {
    await expect(
      service.getBreakdownAsOf('client-1', TODAY, TODAY),
    ).resolves.toEqual({
      date: TODAY,
      installments: [],
      totalPayableOnDate: 0,
    });
    expect(paymentsRepository.find).not.toHaveBeenCalled();
  });

  it('rejects a day later than today', async () => {
    await expect(
      service.getBreakdownAsOf('client-1', '2026-10-10', TODAY),
    ).rejects.toThrow(BadRequestException);
    expect(installmentsRepository.find).not.toHaveBeenCalled();
  });
});
