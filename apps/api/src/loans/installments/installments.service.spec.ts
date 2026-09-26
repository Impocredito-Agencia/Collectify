import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  ConceptCalculationType,
  ConceptCategory,
} from '../../interestConceptTypes/entities/interestConceptType.entity';
import { Installment, InstallmentStatus } from '../entities/installment.entity';
import { Loan, LoanStatus } from '../entities/loan.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';
import { Payment } from '../entities/payment.entity';
import { PaymentImage } from '../entities/paymentImage.entity';

import { ClientCreditBalanceService } from '../../clients/clientCreditBalance.service';
import { WhatsappInboundMessage } from '../../whatsapp/entities/whatsappInboundMessage.entity';
import { PaymentConfirmationService } from '../../whatsapp/paymentConfirmation.service';

import { enrichInstallment } from './enrichInstallment';
import { calculateMoraCharged } from './installmentCalculations';
import { InstallmentsService } from './installments.service';

describe('InstallmentsService', () => {
  let service: InstallmentsService;
  let installmentsRepository: {
    findOne: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
  };
  let paymentsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let loansRepository: { update: jest.Mock; findOne: jest.Mock };
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let paymentImagesRepository: { create: jest.Mock; save: jest.Mock };
  let whatsappInboundMessagesRepository: { update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let paymentConfirmationService: {
    sendPaymentConfirmation: jest.Mock;
    sendPaidInFull: jest.Mock;
  };
  let clientCreditBalanceService: {
    getBalance: jest.Mock;
    recordExcess: jest.Mock;
    recordApplication: jest.Mock;
    assertCanApply: jest.Mock;
  };

  // loan is typed `as never` (Installment.loan is a required relation, but
  // neither registerPayment/registerBulkPayments nor resolveRemainingBalance
  // read anything off it since Loan.interestRate was removed 2026-09-09 —
  // see enrichInstallment.ts's own note) — this fixture just needs to
  // satisfy the type, not carry real data.
  //
  // Bug fix, 2026-09-08 — dueDate moved from a past date (2026-01-01, which
  // aged into "overdue, accruing real mora" as the calendar caught up to it)
  // to a fixed far-future one: since closing a cuota now requires covering
  // its real remaining balance (capital + accrued mora, not just `amount`
  // — see registerPayment's own doc comment on this date), most tests below
  // that pay exactly `amount` need a deterministic, mora-free installment to
  // keep meaning what they say. The handful of tests that specifically
  // exercise mora-aware closing build their own overdue fixture locally
  // instead (see the "does NOT mark ... paid" / "marks ... once ... mora"
  // tests below).
  const mockInstallment: Installment = {
    id: 'inst-1',
    loanId: 'loan-1',
    loan: {} as never,
    installmentNumber: 1,
    amount: 200000,
    principalPortion: null,
    dueDate: '2099-01-01',
    status: InstallmentStatus.Pending,
    isDownPayment: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const paymentDto = { amountPaid: 100000, paidAt: '2026-01-05' };

  beforeEach(async () => {
    installmentsRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn((installment: Partial<Installment>) =>
        Promise.resolve(installment),
      ),
    };
    paymentsRepository = {
      create: jest.fn((dto: Partial<Payment>) => dto),
      save: jest.fn((payment: Partial<Payment>) => Promise.resolve(payment)),
      // Bug fix, 2026-09-07 — defaults to no payments found, so findAll's
      // new sumPaymentsByInstallmentId call (and any other caller that
      // doesn't set its own resolution) has something iterable rather than
      // undefined. Every registerPayment/registerBulkPayments test below
      // sets its own resolution before calling the service, which takes
      // precedence over this default.
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    loansRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      // Defaults to an ordinary (non-new) loan — loanBypassesConfirmationPause
      // resolves false unless a test overrides this to exercise the isNewLoan
      // bypass explicitly.
      findOne: jest.fn().mockResolvedValue({ isNewLoan: false }),
    };
    loanInstallmentConceptsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    paymentImagesRepository = {
      create: jest.fn((dto: Partial<PaymentImage>) => dto),
      save: jest.fn((images: unknown[]) => Promise.resolve(images)),
    };
    whatsappInboundMessagesRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
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
                // Bug fix, 2026-09-07 — registerBulkPayments now fetches
                // concepts per entry too (resolveRemainingBalance), same as
                // registerPayment already did outside the transaction.
                if (entity === LoanInstallmentConcept) {
                  return loanInstallmentConceptsRepository;
                }
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
    clientCreditBalanceService = {
      getBalance: jest.fn().mockResolvedValue(0),
      recordExcess: jest.fn().mockResolvedValue(undefined),
      recordApplication: jest.fn().mockResolvedValue(undefined),
      assertCanApply: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: getRepositoryToken(WhatsappInboundMessage),
          useValue: whatsappInboundMessagesRepository,
        },
        { provide: DataSource, useValue: dataSource },
        {
          provide: PaymentConfirmationService,
          useValue: paymentConfirmationService,
        },
        {
          provide: ClientCreditBalanceService,
          useValue: clientCreditBalanceService,
        },
      ],
    }).compile();

    service = module.get<InstallmentsService>(InstallmentsService);
  });

  describe('findAll', () => {
    const installmentWithLoan: Installment = {
      ...mockInstallment,
      loan: {} as never,
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
          value: 5,
          calculationType: ConceptCalculationType.Percentage,
        },
      ]);

      const result = await service.findAll({});

      expect(result.items[0].conceptBreakdown).toEqual([
        {
          name: 'Interés remuneratorio',
          amount: 4000,
          category: ConceptCategory.Corriente,
          value: 5,
          calculationType: ConceptCalculationType.Percentage,
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
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      // Static mock: both the new pre-save ceiling check and the existing
      // post-save status check see the same "100000 already paid" figure —
      // fine here since 100000 stays under the 200000 ceiling either way.
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

    // Bug fix, 2026-09-08 (human decision) — closing a cuota now requires
    // covering the REAL remaining balance (capital + accrued mora), not
    // installment.amount alone (see registerPayment's own doc comment on
    // this date). mockInstallment's dueDate is fixed far in the future (see
    // its own comment above), so `amount` and the real remaining balance
    // are the same number here — deterministic, and mora-aware closing
    // itself isn't what these three tests are about (that's covered by the
    // dedicated mora-closing tests further below).
    it('marks the installment paid when accumulated payments cover the real remaining balance exactly', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      // Sequenced, unlike the partial-payment test above: this payment
      // exactly matches the installment's amount, so a single static mock
      // would make the pre-save ceiling check see it as already paid
      // (remaining balance 0) and wrongly reject it. First call (ceiling
      // check, before save) sees nothing paid yet; second call (post-save
      // status check) sees the payment that was just recorded.
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
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

    // Human report, 2026-09-19 — a payment sourced from a real WhatsApp
    // comprobante must always notify, regardless of
    // PAYMENT_CONFIRMATION_MESSAGES_PAUSED (checked inside
    // PaymentConfirmationService itself — this only verifies the flag is
    // derived and forwarded correctly).
    it('bypasses the payment-confirmation pause when sourceWhatsappMessageId is set', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
      ]);

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
        sourceWhatsappMessageId: 'wa-msg-1',
      });

      expect(
        paymentConfirmationService.sendPaymentConfirmation,
      ).toHaveBeenCalledWith(mockInstallment.id, { bypassPause: true });
    });

    // Human report, 2026-09-19 — a payment registered normally (no
    // sourceWhatsappMessageId) on a loan marked isNewLoan must still bypass
    // the pause: it's a genuinely new loan created during testing, not one
    // of the historical/backfilled loans the flag exists to silence.
    it('bypasses the payment-confirmation pause when the loan is marked isNewLoan', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
      ]);
      loansRepository.findOne.mockResolvedValue({ isNewLoan: true });

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
      });

      expect(
        paymentConfirmationService.sendPaymentConfirmation,
      ).toHaveBeenCalledWith(mockInstallment.id, { bypassPause: true });
    });

    it('does not bypass the payment-confirmation pause for an ordinary payment', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
      mockInstallmentsFind([
        { ...mockInstallment, status: InstallmentStatus.Paid },
      ]);

      await service.registerPayment(mockInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
      });

      expect(
        paymentConfirmationService.sendPaymentConfirmation,
      ).toHaveBeenCalledWith(mockInstallment.id, { bypassPause: false });
    });

    it('cascades the loan to paid when every installment of it is paid', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
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
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
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

    // Bug fix, 2026-09-08 (human decision) — the actual new behavior: a
    // payment that covers installment.amount exactly but leaves accrued
    // mora unpaid no longer closes the cuota. Builds its own overdue
    // fixture (mockInstallment itself is fixed far in the future — see its
    // own comment above — specifically so it accrues no mora by default).
    it('does NOT mark an overdue installment paid when only its principal is covered, leaving mora outstanding', async () => {
      const overdueInstallment: Installment = {
        ...mockInstallment,
        dueDate: '2026-01-01',
      };
      installmentsRepository.findOne.mockResolvedValue(overdueInstallment);
      // The payment covers installment.amount (200000) exactly, but this
      // installment has been overdue since 2026-01-01 and has a real
      // moratory concept assigned, so real totalDue is
      // 200000 + accrued mora > 200000 — remainingBalanceAfter is still > 0.
      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: 200000 }]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: overdueInstallment.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
        },
      ]);
      mockInstallmentsFind();

      await service.registerPayment(overdueInstallment.id, {
        amountPaid: 200000,
        paidAt: '2026-01-05',
      });

      expect(installmentsRepository.update).not.toHaveBeenCalled();
      expect(loansRepository.update).not.toHaveBeenCalled();
    });

    // Bug fix, 2026-09-08 (human decision) — the mirror-image confirmation:
    // paying capital AND the full accrued mora together does close it.
    it('marks an overdue installment paid once both principal and accrued mora are fully covered', async () => {
      const overdueInstallment: Installment = {
        ...mockInstallment,
        dueDate: '2025-01-01',
      };
      installmentsRepository.findOne.mockResolvedValue(overdueInstallment);
      // Pay the installment's full live totalDue (from enrichInstallment,
      // computed with today's real overdueDays) — read it back from the
      // service's own math rather than hand-computing the mora fixture,
      // so this test doesn't drift from the interest formula over time.
      const fullTotalDue = enrichInstallment(overdueInstallment).totalDue;

      paymentsRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amountPaid: fullTotalDue }]);
      mockInstallmentsFind([
        { ...overdueInstallment, status: InstallmentStatus.Paid },
      ]);

      await service.registerPayment(overdueInstallment.id, {
        amountPaid: fullTotalDue,
        paidAt: '2026-01-05',
      });

      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: overdueInstallment.id },
        { status: InstallmentStatus.Paid },
      );
    });

    // Human request, 2026-09-25 — a payment may forgive accrued mora, but
    // only when it settles the cuota completely and to the exact peso.
    describe('mora waiver', () => {
      // Overdue for years with a real moratory concept, so there is real mora
      // to forgive. Everything below is read back from the same functions the
      // service uses, so the fixture can't drift from the interest formula.
      const overdue: Installment = {
        ...mockInstallment,
        dueDate: '2025-01-01',
      };
      const moratoryConcept = {
        installmentId: overdue.id,
        category: ConceptCategory.Moratorio,
        calculationType: ConceptCalculationType.Percentage,
        nameSnapshot: 'Intereses moratorios',
        value: 6,
      };
      beforeEach(() => {
        installmentsRepository.findOne.mockResolvedValue(overdue);
        loanInstallmentConceptsRepository.find.mockResolvedValue([
          moratoryConcept,
        ]);
        mockInstallmentsFind([{ ...overdue, status: InstallmentStatus.Paid }]);
      });

      const concepts = [moratoryConcept] as never as LoanInstallmentConcept[];
      const balance = (): number =>
        enrichInstallment(overdue, concepts).totalDue;
      const moraCharged = (): number =>
        calculateMoraCharged(
          overdue.amount,
          enrichInstallment(overdue, concepts).interest,
        );

      it('closes the cuota when amountPaid + waiver settles it exactly, and records both', async () => {
        const waiver = 10000;
        const amountPaid = balance() - waiver;
        paymentsRepository.find
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ amountPaid, moraWaivedAmount: waiver }]);

        await service.registerPayment(overdue.id, {
          amountPaid,
          paidAt: '2026-01-05',
          moraWaivedAmount: waiver,
          moraWaiverReason: '  Pagó todo de contado  ',
        });

        expect(paymentsRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            amountPaid,
            moraWaivedAmount: waiver,
            moraWaiverReason: 'Pagó todo de contado',
          }),
        );
        expect(installmentsRepository.update).toHaveBeenCalledWith(
          { id: overdue.id },
          { status: InstallmentStatus.Paid },
        );
        expect(clientCreditBalanceService.recordExcess).not.toHaveBeenCalled();
      });

      it('forgiving ALL the mora leaves exactly the capital to pay (no stray pesos)', async () => {
        const amountPaid = balance() - moraCharged();
        expect(amountPaid).toBe(overdue.amount);
        paymentsRepository.find
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { amountPaid, moraWaivedAmount: moraCharged() },
          ]);

        await service.registerPayment(overdue.id, {
          amountPaid,
          paidAt: '2026-01-05',
          moraWaivedAmount: moraCharged(),
        });

        expect(installmentsRepository.update).toHaveBeenCalledWith(
          { id: overdue.id },
          { status: InstallmentStatus.Paid },
        );
      });

      it('rejects a payment one peso SHORT of balance − waiver (the cuota would stay open)', async () => {
        paymentsRepository.find.mockResolvedValue([]);

        await expect(
          service.registerPayment(overdue.id, {
            amountPaid: balance() - 10000 - 1,
            paidAt: '2026-01-05',
            moraWaivedAmount: 10000,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(paymentsRepository.save).not.toHaveBeenCalled();
      });

      it('rejects a payment one peso OVER balance − waiver (it must not silently become saldo a favor)', async () => {
        paymentsRepository.find.mockResolvedValue([]);

        await expect(
          service.registerPayment(overdue.id, {
            amountPaid: balance() - 10000 + 1,
            paidAt: '2026-01-05',
            moraWaivedAmount: 10000,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(paymentsRepository.save).not.toHaveBeenCalled();
        expect(clientCreditBalanceService.recordExcess).not.toHaveBeenCalled();
      });

      it('rejects a waiver bigger than the mora actually being charged', async () => {
        paymentsRepository.find.mockResolvedValue([]);
        const waiver = moraCharged() + 1;

        await expect(
          service.registerPayment(overdue.id, {
            amountPaid: balance() - waiver,
            paidAt: '2026-01-05',
            moraWaivedAmount: waiver,
          }),
        ).rejects.toThrow(/supera la mora/);
        expect(paymentsRepository.save).not.toHaveBeenCalled();
      });

      it('rejects a waiver on a cuota that has no mora', async () => {
        // mockInstallment is due far in the future — nothing accrued.
        installmentsRepository.findOne.mockResolvedValue(mockInstallment);
        paymentsRepository.find.mockResolvedValue([]);

        await expect(
          service.registerPayment(mockInstallment.id, {
            amountPaid: mockInstallment.amount - 1,
            paidAt: '2026-01-05',
            moraWaivedAmount: 1,
          }),
        ).rejects.toThrow(/no tiene mora/);
        expect(paymentsRepository.save).not.toHaveBeenCalled();
      });

      it('rejects a stale screen: mora grew since the amount was computed', async () => {
        paymentsRepository.find.mockResolvedValue([]);
        // What the screen computed yesterday, when the balance was $100 lower.
        const yesterdaysAmount = balance() - 100 - 10000;

        await expect(
          service.registerPayment(overdue.id, {
            amountPaid: yesterdaysAmount,
            paidAt: '2026-01-05',
            moraWaivedAmount: 10000,
          }),
        ).rejects.toThrow(/debe pagarse por exactamente/);
        expect(paymentsRepository.save).not.toHaveBeenCalled();
      });

      it('records no waiver fields for an ordinary payment', async () => {
        paymentsRepository.find.mockResolvedValue([]);

        await service.registerPayment(overdue.id, {
          amountPaid: 50000,
          paidAt: '2026-01-05',
        });

        expect(paymentsRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            moraWaivedAmount: 0,
            moraWaiverReason: null,
          }),
        );
      });
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
      installmentsRepository.findOne.mockResolvedValue(installment3);
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

    // Bug fix, 2026-09-07 (human report, préstamo #0920) — the actual
    // scenario that broke: a first partial payment ($150.000 of $200.000)
    // left a real $50.000 balance, and a second payment for MORE than that
    // ($100.000) used to go through unchecked, marking the loan paid with
    // money that was never actually owed. A future dueDate keeps mora at
    // exactly 0 here, so the ceiling is deterministic ($50.000) regardless
    // of when this test runs.
    //
    // Bug fix, 2026-09-14 (human decision) — rejecting the excess outright
    // is no longer the fix: it's capped out of THIS installment's own
    // Payment row (must never exceed what it truly owed) and recorded as a
    // client-level credit instead — see ClientCreditLedgerEntry's own
    // comment. Renamed and rewritten from "rejects a payment that
    // exceeds..." to reflect the new confirmed behavior.
    it("caps the payment at the installment's real remaining balance and records the excess as a client credit", async () => {
      const notOverdueInstallment: Installment = {
        ...mockInstallment,
        dueDate: '2099-01-01',
      };
      installmentsRepository.findOne.mockResolvedValue(notOverdueInstallment);
      paymentsRepository.find.mockResolvedValueOnce([{ amountPaid: 150000 }]);
      mockInstallmentsFind();
      loansRepository.findOne.mockResolvedValue({
        isNewLoan: false,
        clientId: 'client-1',
      });

      const result = await service.registerPayment(notOverdueInstallment.id, {
        amountPaid: 100000,
        paidAt: '2026-01-05',
      });

      expect(result).toMatchObject({ amountPaid: 50000 });
      expect(clientCreditBalanceService.recordExcess).toHaveBeenCalledWith(
        'client-1',
        result.id,
        50000,
      );
    });

    it('accepts a payment that exactly matches the real remaining balance', async () => {
      const notOverdueInstallment: Installment = {
        ...mockInstallment,
        dueDate: '2099-01-01',
      };
      installmentsRepository.findOne.mockResolvedValue(notOverdueInstallment);
      paymentsRepository.find
        .mockResolvedValueOnce([{ amountPaid: 150000 }])
        .mockResolvedValueOnce([{ amountPaid: 150000 }, { amountPaid: 50000 }]);
      mockInstallmentsFind([
        { ...notOverdueInstallment, status: InstallmentStatus.Paid },
      ]);

      const result = await service.registerPayment(notOverdueInstallment.id, {
        amountPaid: 50000,
        paidAt: '2026-01-05',
      });

      expect(result).toMatchObject({ amountPaid: 50000 });
      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: notOverdueInstallment.id },
        { status: InstallmentStatus.Paid },
      );
    });

    // Deliberate tightening of the old Phase 32 behavior (see this
    // service's doc comment on the balance-ceiling check): an installment
    // that's already Paid or Cancelled has a remaining balance of 0 (see
    // enrichInstallment's non-Pending short-circuit), so it can no longer
    // silently accept an extra payment record either — before ever
    // reaching the sequential-payment rule (which only applies to Pending
    // installments in the first place).
    //
    // Bug fix, 2026-09-14 (human decision) — routes into credit instead of
    // rejecting, same as the test above. The ENTIRE amount becomes credit
    // here (the installment's own remaining balance is 0), not just a
    // slice of it.
    it('routes the entire amount into a client credit for an already-paid installment, without running the sequential-payment check', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        ...mockInstallment,
        status: InstallmentStatus.Paid,
      });
      loansRepository.findOne.mockResolvedValue({
        isNewLoan: false,
        clientId: 'client-1',
      });

      const result = await service.registerPayment(
        mockInstallment.id,
        paymentDto,
      );

      expect(installmentsRepository.find).not.toHaveBeenCalled();
      expect(installmentsRepository.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ amountPaid: 0 });
      expect(clientCreditBalanceService.recordExcess).toHaveBeenCalledWith(
        'client-1',
        result.id,
        paymentDto.amountPaid,
      );
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      installmentsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.registerPayment('missing-id', paymentDto),
      ).rejects.toThrow(NotFoundException);
    });

    // Phase 28 — imageUrl itself is deprecated (always stored null for new
    // payments, see payment.entity.ts); photos persist as PaymentImage rows
    // instead, one per URL in imageUrls.
    it('persists one PaymentImage row per URL in imageUrls', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
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
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      mockInstallmentsFind();

      const result = await service.registerPayment(
        mockInstallment.id,
        paymentDto,
      );

      expect(result).toMatchObject({ imageUrl: null });
      expect(paymentImagesRepository.save).not.toHaveBeenCalled();
    });

    // Human report, 2026-09-11 — the "Registrar pago con este comprobante"
    // flow's linking step.
    it('links the payment to the source WhatsappInboundMessage when sourceWhatsappMessageId is given', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      paymentsRepository.save.mockResolvedValue({
        ...paymentDto,
        id: 'payment-1',
      });
      mockInstallmentsFind();

      await service.registerPayment(mockInstallment.id, {
        ...paymentDto,
        sourceWhatsappMessageId: 'wa-msg-1',
      });

      expect(whatsappInboundMessagesRepository.update).toHaveBeenCalledWith(
        { id: 'wa-msg-1' },
        { paymentId: 'payment-1' },
      );
    });

    it('does not touch WhatsappInboundMessage when sourceWhatsappMessageId is omitted', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      mockInstallmentsFind();

      await service.registerPayment(mockInstallment.id, paymentDto);

      expect(whatsappInboundMessagesRepository.update).not.toHaveBeenCalled();
    });

    it('still registers the payment when sourceWhatsappMessageId matches no message', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      paymentsRepository.save.mockResolvedValue({
        ...paymentDto,
        id: 'payment-1',
      });
      whatsappInboundMessagesRepository.update.mockResolvedValue({
        affected: 0,
      });
      mockInstallmentsFind();

      await expect(
        service.registerPayment(mockInstallment.id, {
          ...paymentDto,
          sourceWhatsappMessageId: 'wa-msg-does-not-exist',
        }),
      ).resolves.toMatchObject(paymentDto);
    });

    it('still registers the payment when the WhatsappInboundMessage update throws unexpectedly', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([{ amountPaid: 100000 }]);
      paymentsRepository.save.mockResolvedValue({
        ...paymentDto,
        id: 'payment-1',
      });
      whatsappInboundMessagesRepository.update.mockRejectedValue(
        new Error('DB is down'),
      );
      mockInstallmentsFind();

      await expect(
        service.registerPayment(mockInstallment.id, {
          ...paymentDto,
          sourceWhatsappMessageId: 'wa-msg-1',
        }),
      ).resolves.toMatchObject(paymentDto);
    });
  });

  // Human report, 2026-09-14 — the explicit, operator-initiated half of
  // saldo a favor. Delegates to registerPayment (fundedByCredit: true)
  // rather than duplicating its close/cascade/confirmation logic.
  describe('applyCreditToInstallment', () => {
    it('validates via ClientCreditBalanceService before touching anything', async () => {
      clientCreditBalanceService.assertCanApply.mockRejectedValue(
        new BadRequestException(
          'El saldo a favor disponible ($0) es menor al monto solicitado ($50000).',
        ),
      );

      await expect(
        service.applyCreditToInstallment('client-1', mockInstallment.id, 50000),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.findOne).not.toHaveBeenCalled();
      expect(
        clientCreditBalanceService.recordApplication,
      ).not.toHaveBeenCalled();
    });

    it('registers the payment as fundedByCredit and records the application', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([]);
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) =>
          Promise.resolve(where?.installmentNumber ? [] : []),
      );

      const result = await service.applyCreditToInstallment(
        'client-1',
        mockInstallment.id,
        200000,
      );

      expect(clientCreditBalanceService.assertCanApply).toHaveBeenCalledWith(
        'client-1',
        mockInstallment.id,
        200000,
      );
      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amountPaid: 200000,
          fundedByCredit: true,
        }),
      );
      expect(clientCreditBalanceService.recordApplication).toHaveBeenCalledWith(
        'client-1',
        result.id,
        200000,
      );
      // The installment owed exactly 200000 — no leftover to recycle back
      // into a fresh credit.
      expect(clientCreditBalanceService.recordExcess).not.toHaveBeenCalled();
    });

    it('recycles any leftover back into a fresh credit when the applied amount exceeds what the installment needed', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      paymentsRepository.find.mockResolvedValue([]);
      installmentsRepository.find.mockResolvedValue([]);
      loansRepository.findOne.mockResolvedValue({
        isNewLoan: false,
        clientId: 'client-1',
      });

      const result = await service.applyCreditToInstallment(
        'client-1',
        mockInstallment.id,
        250000,
      );

      // Capped at what the installment actually owed (200000) — never
      // records more against a single installment than it truly owed.
      expect(result).toMatchObject({ amountPaid: 200000 });
      expect(clientCreditBalanceService.recordExcess).toHaveBeenCalledWith(
        'client-1',
        result.id,
        50000,
      );
      expect(clientCreditBalanceService.recordApplication).toHaveBeenCalledWith(
        'client-1',
        result.id,
        250000,
      );
    });
  });

  describe('registerBulkPayments', () => {
    const installment2: Installment = {
      ...mockInstallment,
      id: 'inst-2',
      installmentNumber: 2,
    };

    beforeEach(() => {
      // Fresh installment per findOne call, matched by id — mirrors how the
      // loop looks up each entry's own installment. relations.loan isn't
      // modeled here (this mock ignores it entirely) — every fixture
      // installment already carries its own `loan` field directly (see
      // mockInstallment), same as registerPayment's tests above.
      installmentsRepository.findOne.mockImplementation(
        ({ where }: { where?: { id?: string } } = {}) =>
          Promise.resolve(
            [mockInstallment, installment2].find((i) => i.id === where?.id) ??
              null,
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
      installmentsRepository.findOne.mockResolvedValue({
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
      installmentsRepository.findOne.mockResolvedValue(null);

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
      installmentsRepository.findOne.mockImplementation(
        ({ where }: { where?: { id?: string } } = {}) =>
          Promise.resolve(
            [mockInstallment, sameLoanInstallment2].find(
              (i) => i.id === where?.id,
            ) ?? null,
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
      installmentsRepository.findOne.mockImplementation(
        ({ where }: { where?: { id?: string } } = {}) =>
          Promise.resolve(
            [mockInstallment, sameLoanInstallment2].find(
              (i) => i.id === where?.id,
            ) ?? null,
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

    // Bug fix, 2026-09-07 — the bulk endpoint had the exact same gap as
    // registerPayment: a floor check (must cover installment.amount) but no
    // ceiling at all. An absurdly large amount guarantees it exceeds the
    // real remaining balance (installment.amount, mockInstallment accruing
    // no mora by construction — see its own comment above) regardless of
    // when this test runs.
    it("rejects a bulk entry whose amount exceeds the installment's real remaining balance", async () => {
      await expect(
        service.registerBulkPayments([
          {
            installmentId: mockInstallment.id,
            amountPaid: 999999999,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.update).not.toHaveBeenCalled();
    });

    // Bug fix, 2026-09-08 (human decision) — mirrors registerPayment's own
    // mora-closing tests: a bulk entry that covers installment.amount
    // exactly but not the accrued mora on an overdue cuota no longer counts
    // as "fully settled" — it used to (the floor check only ever looked at
    // installment.amount).
    it('rejects a bulk entry that covers the principal but not the accrued mora on an overdue installment', async () => {
      const overdueInstallment: Installment = {
        ...mockInstallment,
        dueDate: '2026-01-01',
      };
      installmentsRepository.findOne.mockImplementation(
        ({ where }: { where?: { id?: string } } = {}) =>
          Promise.resolve(
            where?.id === overdueInstallment.id ? overdueInstallment : null,
          ),
      );
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: overdueInstallment.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
        },
      ]);

      await expect(
        service.registerBulkPayments([
          {
            installmentId: overdueInstallment.id,
            amountPaid: overdueInstallment.amount,
            paidAt: '2026-01-05',
          },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.update).not.toHaveBeenCalled();
    });
  });

  // Human request, 2026-09-25 — a bulk payment can forgive mora per cuota;
  // each entry still has to settle its cuota exactly.
  describe('registerBulkPayments mora waiver', () => {
    const overdue: Installment = {
      ...mockInstallment,
      id: 'inst-overdue',
      dueDate: '2025-01-01',
    };
    const concepts = [
      {
        installmentId: overdue.id,
        category: ConceptCategory.Moratorio,
        calculationType: ConceptCalculationType.Percentage,
        nameSnapshot: 'Intereses moratorios',
        value: 6,
      },
    ] as never as LoanInstallmentConcept[];
    const balance = (): number => enrichInstallment(overdue, concepts).totalDue;

    beforeEach(() => {
      installmentsRepository.findOne.mockImplementation(
        ({ where }: { where?: { id?: string } } = {}) =>
          Promise.resolve(where?.id === overdue.id ? overdue : null),
      );
      paymentsRepository.find.mockResolvedValue([]);
      paymentsRepository.save.mockImplementation((payment: Partial<Payment>) =>
        Promise.resolve({ id: `payment-${payment.installmentId}`, ...payment }),
      );
      loanInstallmentConceptsRepository.find.mockResolvedValue(concepts);
      installmentsRepository.find.mockImplementation(
        ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where?.id) {
            return Promise.resolve([overdue]);
          }
          if (where?.installmentNumber) {
            return Promise.resolve([]);
          }
          return Promise.resolve([{ ...overdue }]);
        },
      );
    });

    it('records the waiver on an entry that pays balance − waiver exactly', async () => {
      const waiver = 12000;

      await service.registerBulkPayments([
        {
          installmentId: overdue.id,
          amountPaid: balance() - waiver,
          paidAt: '2026-01-05',
          moraWaivedAmount: waiver,
          moraWaiverReason: 'Pago por lote de contado',
        },
      ]);

      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amountPaid: balance() - waiver,
          moraWaivedAmount: waiver,
          moraWaiverReason: 'Pago por lote de contado',
        }),
      );
      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: overdue.id },
        { status: InstallmentStatus.Paid },
      );
    });

    it('rejects an entry one peso off balance − waiver, in either direction', async () => {
      for (const delta of [-1, 1]) {
        await expect(
          service.registerBulkPayments([
            {
              installmentId: overdue.id,
              amountPaid: balance() - 12000 + delta,
              paidAt: '2026-01-05',
              moraWaivedAmount: 12000,
            },
          ]),
        ).rejects.toThrow(BadRequestException);
      }
      expect(paymentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a waiver bigger than the mora being charged', async () => {
      await expect(
        service.registerBulkPayments([
          {
            installmentId: overdue.id,
            amountPaid: 1,
            paidAt: '2026-01-05',
            moraWaivedAmount: balance(),
          },
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(paymentsRepository.save).not.toHaveBeenCalled();
    });
  });

  // Human report, 2026-09-09 — admin-only correction for a payment
  // registered by mistake. See voidPayment's own doc comment on the
  // service for the full design rationale.
  describe('voidPayment', () => {
    const paidInstallment: Installment = {
      ...mockInstallment,
      status: InstallmentStatus.Paid,
    };

    // A factory, not a shared const — voidPayment mutates the object it's
    // given (payment.deletedAt = ..., see the service's own comment on
    // saving both fields together), so reusing one instance across tests
    // would leak a previous test's void into the next one.
    function makeMockPayment(): Payment {
      return {
        id: 'payment-1',
        installmentId: paidInstallment.id,
        amountPaid: paidInstallment.amount,
        paidAt: '2026-01-05',
        observation: null,
        imageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        voidReason: null,
        moraWaivedAmount: 0,
        moraWaiverReason: null,
        fundedByCredit: false,
        installment: paidInstallment,
      };
    }

    const voidDto = {
      reason:
        'Se registró el monto completo por error; el cliente solo pagó una parte.',
    };

    it('looks up the payment including already-voided rows, with its installment relation', async () => {
      const mockPayment = makeMockPayment();
      paymentsRepository.findOne.mockResolvedValue(mockPayment);
      paymentsRepository.find.mockResolvedValue([]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([]);

      await service.voidPayment(mockPayment.id, voidDto);

      expect(paymentsRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockPayment.id },
        withDeleted: true,
        relations: { installment: true },
      });
    });

    // Human request, 2026-09-25 — voiding one payment of a cuota that another
    // payment closed WITH a mora waiver: that waiver still counts as covered,
    // so the cuota must stay paid when the rest of it is still settled, and
    // reopen when it is not.
    describe('with a mora waiver on another payment of the same cuota', () => {
      const overdue: Installment = {
        ...mockInstallment,
        dueDate: '2025-01-01',
        status: InstallmentStatus.Paid,
      };
      const concepts = [
        {
          installmentId: overdue.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
        },
      ] as never as LoanInstallmentConcept[];
      const balance = (): number =>
        enrichInstallment(
          { ...overdue, status: InstallmentStatus.Pending },
          concepts,
        ).totalDue;

      const voidedPayment = (): Payment => ({
        id: 'payment-void',
        installmentId: overdue.id,
        amountPaid: 1000,
        paidAt: '2026-01-05',
        observation: null,
        imageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        voidReason: null,
        moraWaivedAmount: 0,
        moraWaiverReason: null,
        fundedByCredit: false,
        installment: overdue,
      });

      beforeEach(() => {
        loanInstallmentConceptsRepository.find.mockResolvedValue(concepts);
      });

      it('keeps the cuota paid when the remaining payment plus its waiver still settle it', async () => {
        const waiver = 10000;
        paymentsRepository.findOne.mockResolvedValue(voidedPayment());
        paymentsRepository.find.mockResolvedValue([
          {
            amountPaid: balance() - waiver,
            moraWaivedAmount: waiver,
          },
        ]);

        await service.voidPayment('payment-void', voidDto);

        expect(installmentsRepository.update).not.toHaveBeenCalled();
      });

      it('reopens the cuota when the payment that carried the waiver is the one voided (mora is owed again)', async () => {
        paymentsRepository.findOne.mockResolvedValue({
          ...voidedPayment(),
          amountPaid: balance() - 10000,
          moraWaivedAmount: 10000,
        });
        paymentsRepository.find.mockResolvedValue([]);

        await service.voidPayment('payment-void', voidDto);

        expect(installmentsRepository.update).toHaveBeenCalledWith(
          { id: overdue.id },
          { status: InstallmentStatus.Pending },
        );
      });
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      paymentsRepository.findOne.mockResolvedValue(null);

      await expect(service.voidPayment('missing-id', voidDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(paymentsRepository.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the payment was already voided', async () => {
      const mockPayment = makeMockPayment();
      paymentsRepository.findOne.mockResolvedValue({
        ...mockPayment,
        deletedAt: new Date(),
      });

      await expect(
        service.voidPayment(mockPayment.id, voidDto),
      ).rejects.toThrow(BadRequestException);
      expect(paymentsRepository.save).not.toHaveBeenCalled();
    });

    it('soft-deletes the payment with the given reason', async () => {
      const mockPayment = makeMockPayment();
      paymentsRepository.findOne.mockResolvedValue(mockPayment);
      paymentsRepository.find.mockResolvedValue([]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([]);

      const result = await service.voidPayment(mockPayment.id, voidDto);

      expect(paymentsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedAt: expect.any(Date) as unknown,
          voidReason: voidDto.reason,
        }),
      );
      expect(result.voidReason).toBe(voidDto.reason);
    });

    // sumPayments/resolveRemainingBalance are exercised here with the mock
    // simply returning no other payments for the installment (as if the
    // voided row had already been excluded, which is exactly what a real
    // `.find()` does for a soft-deleted row with no `withDeleted` override
    // — see this test file's own top-level comment on that convention).
    it('reopens the installment and the loan when the voided payment is what had closed both', async () => {
      const mockPayment = makeMockPayment();
      paymentsRepository.findOne.mockResolvedValue(mockPayment);
      paymentsRepository.find.mockResolvedValue([]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([]);

      await service.voidPayment(mockPayment.id, voidDto);

      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { id: paidInstallment.id },
        { status: InstallmentStatus.Pending },
      );
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: paidInstallment.loanId, status: LoanStatus.Paid },
        { status: LoanStatus.Active },
      );
    });

    it('does not reopen anything when another payment still covers the installment in full', async () => {
      const mockPayment = makeMockPayment();
      paymentsRepository.findOne.mockResolvedValue(mockPayment);
      // The remaining payment alone still covers the installment's full
      // amount — resolveRemainingBalance should land back at 0.
      paymentsRepository.find.mockResolvedValue([
        { amountPaid: paidInstallment.amount },
      ]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([]);

      await service.voidPayment(mockPayment.id, voidDto);

      expect(installmentsRepository.update).not.toHaveBeenCalled();
      expect(loansRepository.update).not.toHaveBeenCalled();
    });

    it('does not touch installment/loan status when the installment was never marked Paid', async () => {
      const mockPayment = makeMockPayment();
      paymentsRepository.findOne.mockResolvedValue({
        ...mockPayment,
        installment: mockInstallment, // status: Pending
      });

      await service.voidPayment(mockPayment.id, voidDto);

      expect(installmentsRepository.update).not.toHaveBeenCalled();
      expect(loansRepository.update).not.toHaveBeenCalled();
    });
  });

  // Human report, 2026-09-22 — narrow exception to "a loan's schedule is
  // fixed at creation": moves one pending installment's due date only.
  describe('updateDueDate', () => {
    it('updates the due date of a pending installment with no siblings', async () => {
      installmentsRepository.findOne.mockResolvedValue(mockInstallment);
      installmentsRepository.find.mockResolvedValue([mockInstallment]);

      const result = await service.updateDueDate(mockInstallment.id, {
        dueDate: '2099-02-10',
      });

      expect(result.dueDate).toBe('2099-02-10');
      expect(installmentsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: '2099-02-10' }),
      );
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      installmentsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateDueDate('missing-id', { dueDate: '2099-02-10' }),
      ).rejects.toThrow(NotFoundException);
      expect(installmentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects changing the due date of an already-paid installment', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        ...mockInstallment,
        status: InstallmentStatus.Paid,
      });

      await expect(
        service.updateDueDate(mockInstallment.id, { dueDate: '2099-02-10' }),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a new date earlier than the previous pending installment', async () => {
      const earlier = {
        ...mockInstallment,
        id: 'inst-0',
        installmentNumber: 1,
        dueDate: '2099-02-01',
      };
      const target = {
        ...mockInstallment,
        id: 'inst-1',
        installmentNumber: 2,
        dueDate: '2099-03-01',
      };
      installmentsRepository.findOne.mockResolvedValue(target);
      installmentsRepository.find.mockResolvedValue([earlier, target]);

      await expect(
        service.updateDueDate(target.id, { dueDate: '2099-01-15' }),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a new date later than the next pending installment', async () => {
      const target = {
        ...mockInstallment,
        id: 'inst-1',
        installmentNumber: 1,
        dueDate: '2099-02-01',
      };
      const later = {
        ...mockInstallment,
        id: 'inst-2',
        installmentNumber: 2,
        dueDate: '2099-03-01',
      };
      installmentsRepository.findOne.mockResolvedValue(target);
      installmentsRepository.find.mockResolvedValue([target, later]);

      await expect(
        service.updateDueDate(target.id, { dueDate: '2099-03-15' }),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.save).not.toHaveBeenCalled();
    });

    it('allows a new date between its two pending neighbors', async () => {
      const earlier = {
        ...mockInstallment,
        id: 'inst-0',
        installmentNumber: 1,
        dueDate: '2099-01-01',
      };
      const target = {
        ...mockInstallment,
        id: 'inst-1',
        installmentNumber: 2,
        dueDate: '2099-02-01',
      };
      const later = {
        ...mockInstallment,
        id: 'inst-2',
        installmentNumber: 3,
        dueDate: '2099-03-01',
      };
      installmentsRepository.findOne.mockResolvedValue(target);
      installmentsRepository.find.mockResolvedValue([earlier, target, later]);

      const result = await service.updateDueDate(target.id, {
        dueDate: '2099-02-10',
      });

      expect(result.dueDate).toBe('2099-02-10');
    });
  });

  // Bulk counterpart to updateDueDate above.
  describe('alignDueDay', () => {
    it('moves every pending installment to the requested day of month', async () => {
      loansRepository.findOne.mockResolvedValue({ id: 'loan-1' });
      const first = {
        ...mockInstallment,
        id: 'inst-1',
        installmentNumber: 1,
        dueDate: '2099-01-01',
      };
      const second = {
        ...mockInstallment,
        id: 'inst-2',
        installmentNumber: 2,
        dueDate: '2099-02-01',
      };
      installmentsRepository.find.mockResolvedValue([first, second]);

      const result = await service.alignDueDay('loan-1', { dayOfMonth: 10 });

      expect(result.map((installment) => installment.dueDate)).toEqual([
        '2099-01-10',
        '2099-02-10',
      ]);
      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ dueDate: '2099-01-10' }),
        expect.objectContaining({ dueDate: '2099-02-10' }),
      ]);
    });

    it('clamps to the last day of a shorter month instead of overflowing', async () => {
      loansRepository.findOne.mockResolvedValue({ id: 'loan-1' });
      const installment = {
        ...mockInstallment,
        id: 'inst-1',
        installmentNumber: 1,
        dueDate: '2099-02-01',
      };
      installmentsRepository.find.mockResolvedValue([installment]);

      const result = await service.alignDueDay('loan-1', { dayOfMonth: 31 });

      expect(result[0].dueDate).toBe('2099-02-28');
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await expect(
        service.alignDueDay('missing-loan', { dayOfMonth: 10 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a loan with no pending installments', async () => {
      loansRepository.findOne.mockResolvedValue({ id: 'loan-1' });
      installmentsRepository.find.mockResolvedValue([]);

      await expect(
        service.alignDueDay('loan-1', { dayOfMonth: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('only moves pending installments — find() is scoped to status: Pending', async () => {
      loansRepository.findOne.mockResolvedValue({ id: 'loan-1' });
      installmentsRepository.find.mockResolvedValue([
        { ...mockInstallment, dueDate: '2099-01-01' },
      ]);

      await service.alignDueDay('loan-1', { dayOfMonth: 10 });

      expect(installmentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { loanId: 'loan-1', status: InstallmentStatus.Pending },
        }),
      );
    });
  });
});
