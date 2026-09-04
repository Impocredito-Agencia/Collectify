import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { ConceptCategory } from '../../interestConceptTypes/entities/interestConceptType.entity';
import { Installment, InstallmentStatus } from '../entities/installment.entity';
import { Loan, LoanStatus } from '../entities/loan.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';
import { Payment } from '../entities/payment.entity';
import { PaymentImage } from '../entities/paymentImage.entity';

import { PaymentConfirmationService } from '../../whatsapp/paymentConfirmation.service';

import { InstallmentsService } from './installments.service';

describe('InstallmentsService', () => {
  let service: InstallmentsService;
  let installmentsRepository: {
    findOneBy: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
  };
  let paymentsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let loansRepository: { update: jest.Mock };
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let paymentImagesRepository: { create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let paymentConfirmationService: {
    sendPaymentConfirmation: jest.Mock;
    sendPaidInFull: jest.Mock;
  };

  const mockInstallment: Installment = {
    id: 'inst-1',
    loanId: 'loan-1',
    loan: undefined as never,
    installmentNumber: 1,
    amount: 200000,
    principalPortion: null,
    dueDate: '2026-01-01',
    status: InstallmentStatus.Pending,
    isDownPayment: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const paymentDto = { amountPaid: 100000, paidAt: '2026-01-05' };

  beforeEach(async () => {
    installmentsRepository = {
      findOneBy: jest.fn(),
      update: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
    };
    paymentsRepository = {
      create: jest.fn((dto: Partial<Payment>) => dto),
      save: jest.fn((payment: Partial<Payment>) => Promise.resolve(payment)),
      find: jest.fn(),
    };
    loansRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    loanInstallmentConceptsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    paymentImagesRepository = {
      create: jest.fn((dto: Partial<PaymentImage>) => dto),
      save: jest.fn((images: unknown[]) => Promise.resolve(images)),
    };
    // Mirrors LoansService's own transaction mock (loans.service.spec.ts) —
    // routes manager.getRepository() to the same mocks above by entity
    // class, so registerBulkPayments (run inside dataSource.transaction())
    // exercises the exact mocks every assertion below targets.
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          async (work: (manager: EntityManager) => Promise<unknown>) => {
            const manager = {
              getRepository: (entity: unknown) => {
                if (entity === Installment) return installmentsRepository;
                if (entity === Payment) return paymentsRepository;
                if (entity === Loan) return loansRepository;
                if (entity === PaymentImage) return paymentImagesRepository;
                throw new Error(
                  `No mock repository registered for entity ${String(entity)}`,
                );
              },
            } as unknown as EntityManager;
            return work(manager);
          },
        ),
    };
    paymentConfirmationService = {
      sendPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
      sendPaidInFull: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstallmentsService,
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
        },
        {
          provide: getRepositoryToken(PaymentImage),
          useValue: paymentImagesRepository,
        },
        { provide: DataSource, useValue: dataSource },
        {
          provide: PaymentConfirmationService,
          useValue: paymentConfirmationService,
        },
      ],
    }).compile();

    service = module.get<InstallmentsService>(InstallmentsService);
  });

  describe('findAll', () => {
    const installmentWithLoan: Installment = {
      ...mockInstallment,
      loan: { interestRate: 6 } as never,
    };

    it('attaches each installment its concept breakdown from LoanInstallmentConcept', async () => {
      installmentsRepository.findAndCount.mockResolvedValue([
        [installmentWithLoan],
        1,
      ]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: installmentWithLoan.id,
          nameSnapshot: 'Interés remuneratorio',
          category: ConceptCategory.Corriente,
          computedAmount: 4000,
        },
      ]);

      const result = await service.findAll({});

      expect(result.items[0].conceptBreakdown).toEqual([
        {
          name: 'Interés remuneratorio',
          amount: 4000,
          category: ConceptCategory.Corriente,
        },
      ]);
    });

    it('returns an empty conceptBreakdown when the installment has no concepts', async () => {
      installmentsRepository.findAndCount.mockResolvedValue([
        [installmentWithLoan],
        1,
      ]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result.items[0].conceptBreakdown).toEqual([]);
      expect(loanInstallmentConceptsRepository.find).toHaveBeenCalled();
    });

    it('skips the concepts query entirely when the page is empty', async () => {
      installmentsRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(result.items).toEqual([]);
      expect(loanInstallmentConceptsRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('registerPayment', () => {
    // Phase 32 — installmentsRepository.find() now serves two different
    // queries from registerPayment: the new sequential-payment check
    // (assertNoEarlierPendingInstallment, `where.installmentNumber` set)
    // and the pre-existing cascadeLoanStatusIfFullyPaid check
    // (`where.loanId` only). Distinguishing by the shape of `where` (rather
    // than a single blanket mockResolvedValue, or call order) keeps every
    // test below correct regardless of whether the sequential check even
    // runs for it. Defaults to "nothing earlier pending" — tests that care
    // about the cascade outcome pass their own `cascadeResult`; tests that
    // care about the sequential rejection override this mock directly.
    function mockInstallmentsFind(
      cascadeResult: Partial<Installment>[] = [],
    ): void {
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.installmentNumber) {
            return Promise.resolve([]);
          }
          return Promise.resolve(cascadeResult);
        },
      );
    }

    it('records a partial payment without marking the installment paid', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      mockInstallmentsFind();

      const result = await service.registerPayment(
        mockInstallment.id,
        paymentDto,
      );

      expect(result).toMatchObject(paymentDto);
      expect(installmentsRepository.update).not.toHaveBeenCalled();
      expect(loansRepository.update).not.toHaveBeenCalled();
    });

    it('marks the installment paid when accumulated payments cover the amount exactly', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 200000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
      ]);

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
      });

      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: mockInstallment.id },
        { status: InstallmentStatus.Paid },
      );
    });

    it('marks the installment paid on overpayment (accumulated exceeds the amount)', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 250000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
      ]);

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 250000,
        paidAt: '2026-01-05',
      });

      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: mockInstallment.id },
        { status: InstallmentStatus.Paid },
      );
    });

    it('cascades the loan to paid when every installment of it is paid', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 200000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
      ]);

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
      });

      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockInstallment.loanId, status: LoanStatus.Active },
        { status: LoanStatus.Paid },
      );
    });

    it('does not cascade the loan to paid when other installments are still pending', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 200000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
        { ...mockInstallment, id: 'inst-2', status: InstallmentStatus.Pending },
      ]);

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
      });

      expect(loansRepository.update).not.toHaveBeenCalled();
    });

    // Phase 32 — defense in depth: rejecting this server-side, not just
    // disabling the "pagar" button, is the whole point of the rule (see
    // docs/phases/PHASE_32_UI_FIXES.md).
    it('rejects a payment when an earlier-numbered installment on the same loan is still pending', async () => {
      const installment3: Installment = {
        ...mockInstallment,
        id: 'inst-3',
        installmentNumber: 3,
      };
      installmentsRepository.findOneBy.mockResolvedValue(installment3);
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.installmentNumber) {
            return Promise.resolve([
              { ...mockInstallment, installmentNumber: 1 },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      await expect(
        service.registerPayment(installment3.id, paymentDto),
      ).rejects.toThrow(BadRequestException);
      expect(paymentsRepository.create).not.toHaveBeenCalled();
      expect(paymentsRepository.save).not.toHaveBeenCalled();
    });

    // The rule only gates installments still Pending — an installment
    // that's already resolved (Paid/Cancelled) isn't "skipping ahead" of
    // anything, so an extra payment record against one goes through as
    // before, with no earlier-pending lookup at all.
    it('does not run the sequential-payment check against an already-paid installment', async () => {
      installmentsRepository.findOneBy.mockResolvedValue({
        ...mockInstallment,
        status: InstallmentStatus.Paid,
      });

      await service.registerPayment(mockInstallment.id, paymentDto);

      expect(installmentsRepository.find).not.toHaveBeenCalled();
    });

    it('does not re-evaluate an already-paid installment', async () => {
      installmentsRepository.findOneBy.mockResolvedValue({
        ...mockInstallment,
        status: InstallmentStatus.Paid,
      });

      await service.registerPayment(mockInstallment.id, paymentDto);

      expect(paymentsRepository.find).not.toHaveBeenCalled();
      expect(installmentsRepository.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.registerPayment('missing-id', paymentDto),
      ).rejects.toThrow(NotFoundException);
    });

    // Phase 28 — imageUrl itself is deprecated (always stored null for new
    // payments, see payment.entity.ts); photos persist as PaymentImage rows
    // instead, one per URL in imageUrls.
    it('persists one PaymentImage row per URL in imageUrls', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      mockInstallmentsFind();
      paymentsRepository.save.mockResolvedValue({
        id: 'payment-1',
        ...paymentDto,
      });

      await service.registerPayment(mockInstallment.id, {
        ...paymentDto,
        imageUrls: [
          'https://res.cloudinary.com/demo/image/upload/receipt-1.jpg',
          'https://res.cloudinary.com/demo/image/upload/receipt-2.jpg',
        ],
      });

      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ imageUrl: null }),
      );
      expect(paymentImagesRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          paymentId: 'payment-1',
          imageUrl:
            'https://res.cloudinary.com/demo/image/upload/receipt-1.jpg',
        }),
        expect.objectContaining({
          paymentId: 'payment-1',
          imageUrl:
            'https://res.cloudinary.com/demo/image/upload/receipt-2.jpg',
        }),
      ]);
    });

    it('stores a null imageUrl and no PaymentImage rows when imageUrls is omitted', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      mockInstallmentsFind();

      const result = await service.registerPayment(
        mockInstallment.id,
        paymentDto,
      );

      expect(result).toMatchObject({ imageUrl: null });
      expect(paymentImagesRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('registerBulkPayments', () => {
    const installment2: Installment = {
      ...mockInstallment,
      id: 'inst-2',
      installmentNumber: 2,
    };

    beforeEach(() => {
      // Fresh installment per findOneBy call, matched by id — mirrors how
      // the loop looks up each entry's own installment.
      installmentsRepository.findOneBy.mockImplementation(
        ({ id }: { id: string }) =>
          Promise.resolve(
            [mockInstallment, installment2].find((i) => i.id === id) ?? null,
          ),
      );
      paymentsRepository.find.mockResolvedValue([]);
      paymentsRepository.save.mockImplementation((payment: Partial<Payment>) =>
        Promise.resolve({ id: `payment-${payment.installmentId}`, ...payment }),
      );
      // Phase 32 — installmentsRepository.find() now serves three distinct
      // queries from registerBulkPayments: the installmentNumber lookup
      // used to sort entries before processing (`where.id`, via In()), the
      // sequential-payment check run per entry
      // (assertNoEarlierPendingInstallment, `where.installmentNumber`),
      // and the pre-existing cascadeLoanStatusIfFullyPaid check
      // (`where.loanId` only). Distinguishing by the shape of `where`
      // (rather than call order, which varies with entry count) keeps
      // every test below correct. Defaults: sorting sees both known
      // installments, the sequential check sees nothing earlier pending,
      // and the cascade check sees "not everything paid yet" — matching
      // this suite's behavior before this phase.
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.id) {
            return Promise.resolve([mockInstallment, installment2]);
          }
          if (where?.installmentNumber) {
            return Promise.resolve([]);
          }
          return Promise.resolve([
            { ...mockInstallment, status: InstallmentStatus.Pending },
          ]);
        },
      );
    });

    it('creates one Payment per entry, all within the same transaction', async () => {
      const result = await service.registerBulkPayments([
        {
          installmentId: mockInstallment.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
        },
        {
          installmentId: installment2.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
        },
      ]);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: mockInstallment.id },
        { status: InstallmentStatus.Paid },
      );
      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: installment2.id },
        { status: InstallmentStatus.Paid },
      );
    });

    it('persists imageUrls per entry as separate PaymentImage rows', async () => {
      await service.registerBulkPayments([
        {
          installmentId: mockInstallment.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
          imageUrls: [
            'https://res.cloudinary.com/demo/image/upload/receipt.jpg',
          ],
        },
      ]);

      expect(paymentImagesRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/receipt.jpg',
        }),
      ]);
    });

    it('rejects the whole batch when an entry does not fully cover its installment, before updating any status', async () => {
      await expect(
        service.registerBulkPayments([
          // Only 50000 of a 200000 installment — confirmed rule: a batch
          // requires FULL payment of every selected installment.
          {
            installmentId: mockInstallment.id,
            amountPaid: 50000,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.update).not.toHaveBeenCalled();
    });

    it('rejects the whole batch when an installment is not pending', async () => {
      installmentsRepository.findOneBy.mockResolvedValue({
        ...mockInstallment,
        status: InstallmentStatus.Paid,
      });

      await expect(
        service.registerBulkPayments([
          {
            installmentId: mockInstallment.id,
            amountPaid: 200000,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with NotFoundException when an installment does not exist', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.registerBulkPayments([
          {
            installmentId: 'missing-id',
            amountPaid: 200000,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not persist a later entry once an earlier one in the same batch fails', async () => {
      await expect(
        service.registerBulkPayments([
          {
            installmentId: mockInstallment.id,
            amountPaid: 50000,
            paidAt: '2026-01-05',
          },
          {
            installmentId: installment2.id,
            amountPaid: 200000,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(BadRequestException);
      // The second (valid) entry is never reached — the loop throws on the
      // first invalid one before moving on. A real Postgres transaction
      // additionally rolls back anything already written by an earlier,
      // successfully-processed entry in the same batch; that guarantee
      // isn't observable through these mocks and is verified manually
      // against a real database instead.
      expect(paymentsRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ installmentId: installment2.id }),
      );
    });

    // Phase 32 — the same defense-in-depth rule as registerPayment, applied
    // to the bulk endpoint too (confirmed with the human): "Pagar
    // seleccionadas" shouldn't be a way to skip the sequential rule that
    // the single-payment button enforces.
    it('rejects a bulk entry when an earlier-numbered installment on the same loan (outside the batch) is still pending', async () => {
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.id) {
            return Promise.resolve([installment2]);
          }
          if (where?.installmentNumber) {
            return Promise.resolve([
              { ...mockInstallment, installmentNumber: 1 },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      await expect(
        service.registerBulkPayments([
          {
            installmentId: installment2.id,
            amountPaid: 200000,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.update).not.toHaveBeenCalled();
    });

    // Proves the batch is processed in installment_number order, not
    // submission order — otherwise installment #2 (submitted first here)
    // would false-positive against installment #1 (submitted second, same
    // loan) as "an earlier installment still pending" even though both are
    // being settled together in this same request.
    it('processes a same-loan batch in installment_number order regardless of submission order', async () => {
      const sameLoanInstallment2: Installment = {
        ...installment2,
        loanId: mockInstallment.loanId,
      };
      installmentsRepository.findOneBy.mockImplementation(
        ({ id }: { id: string }) =>
          Promise.resolve(
            [mockInstallment, sameLoanInstallment2].find((i) => i.id === id) ??
              null,
          ),
      );
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.id) {
            return Promise.resolve([mockInstallment, sameLoanInstallment2]);
          }
          if (where?.installmentNumber) {
            return Promise.resolve([]);
          }
          return Promise.resolve([
            { ...mockInstallment, status: InstallmentStatus.Paid },
            { ...sameLoanInstallment2, status: InstallmentStatus.Paid },
          ]);
        },
      );

      // Submitted OUT of order: installment #2 listed before installment #1.
      await service.registerBulkPayments([
        {
          installmentId: sameLoanInstallment2.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
        },
        {
          installmentId: mockInstallment.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
        },
      ]);

      const updateCallOrder = installmentsRepository.update.mock.calls.map(
        ([criteria]: [{ id: string }]) => criteria.id,
      );
      expect(updateCallOrder.indexOf(mockInstallment.id)).toBeLessThan(
        updateCallOrder.indexOf(sameLoanInstallment2.id),
      );
    });

    it('cascades the loan to paid only once even when multiple paid installments belong to it', async () => {
      const sameLoanInstallment2: Installment = {
        ...installment2,
        loanId: mockInstallment.loanId,
      };
      installmentsRepository.findOneBy.mockImplementation(
        ({ id }: { id: string }) =>
          Promise.resolve(
            [mockInstallment, sameLoanInstallment2].find((i) => i.id === id) ??
              null,
          ),
      );
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.id) {
            return Promise.resolve([mockInstallment, sameLoanInstallment2]);
          }
          if (where?.installmentNumber) {
            return Promise.resolve([]);
          }
          return Promise.resolve([
            { ...mockInstallment, status: InstallmentStatus.Paid },
            { ...sameLoanInstallment2, status: InstallmentStatus.Paid },
          ]);
        },
      );

      await service.registerBulkPayments([
        {
          installmentId: mockInstallment.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
        },
        {
          installmentId: sameLoanInstallment2.id,
          amountPaid: 200000,
          paidAt: '2026-01-05',
        },
      ]);

      expect(loansRepository.update).toHaveBeenCalledTimes(1);
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockInstallment.loanId, status: LoanStatus.Active },
        { status: LoanStatus.Paid },
      );
    });
  });
});
