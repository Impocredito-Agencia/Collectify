import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';

import { ClientsService } from '../clients/clients.service';
import {
  ConceptCalculationType,
  ConceptCategory,
  InterestConceptType,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { InterestConceptTypesService } from '../interestConceptTypes/interestConceptTypes.service';
import { UsuryRateService } from '../usuryRates/usuryRates.service';
import { NewLoanReminderService } from '../whatsapp/newLoanReminder.service';

import { addDaysToDateString } from './dueDateSchedule';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { InstallmentFrequency, Loan, LoanStatus } from './entities/loan.entity';
import { LoanInstallmentConcept } from './entities/loanInstallmentConcept.entity';
import { Payment } from './entities/payment.entity';
import { PaymentImage } from './entities/paymentImage.entity';
import { LoansService } from './loans.service';

// Bug fix, 2026-09-04 (see installmentCalculations.ts and
// docs/DATABASE.md's note of that date) — several tests below build a
// dueDate relative to the real `new Date()` (since the service methods
// they exercise always call the real `new Date()` internally too, with no
// injectable override). That dueDate must be anchored to Bogotá's current
// calendar date the same way the fix computes "today" (shifted -5h before
// reading the date), not raw UTC "now" — otherwise, during the narrow UTC
// 00:00-05:00 window (7pm-midnight in Bogotá), an exact-day-count
// assertion here would land one off from what the service actually
// computes: an intermittent CI flake, not a real bug. Reuses
// dueDateSchedule.ts's own pure UTC date-string arithmetic rather than
// date-fns, for the same reason that file avoids date-fns itself (see its
// own top-of-file comment).
function bogotaTodayPlusDays(days: number): string {
  const bogotaToday = new Date(Date.now() - 5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return addDaysToDateString(bogotaToday, days);
}

describe('LoansService', () => {
  let service: LoansService;
  let loansRepository: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let installmentsRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let paymentsRepository: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
  };
  let paymentImagesRepository: { find: jest.Mock };
  let loanInstallmentConceptsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let interestConceptTypesService: {
    findOneOrThrow: jest.Mock;
  };
  let usuryRateService: { getCurrentRate: jest.Mock };
  let clientsService: {
    hasMoraBlock: jest.Mock;
    getCreditUsage: jest.Mock;
    findOne: jest.Mock;
    findByIdIncludingDeleted: jest.Mock;
  };
  let newLoanReminderService: { sendNewLoanMessage: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  // Optional catalog fees (Phase 14) — no longer anything to do with the
  // loan's own interest, which is system-generated (see LoansService.
  // resolveConceptsWithInterest).
  const mockConceptType: InterestConceptType = {
    id: 'concept-type-1',
    name: 'Interés remuneratorio',
    defaultCalculationType: ConceptCalculationType.Percentage,
    defaultValue: 2,
    category: ConceptCategory.Corriente,
    fixedAmountDistribution: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockMoratoryConceptType: InterestConceptType = {
    id: 'moratory-concept-type-1',
    name: 'Interés moratorio',
    defaultCalculationType: ConceptCalculationType.Percentage,
    defaultValue: 2,
    category: ConceptCategory.Moratorio,
    fixedAmountDistribution: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockLoan: Loan = {
    id: 'loan-1',
    clientId: 'client-1',
    client: { firstName: 'Juana', lastName: 'Pérez' } as never,
    promissoryNoteNumber: '#743',
    principalAmount: 900000,
    interestRate: 6,
    disbursedAt: '2025-01-01',
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
  };

  beforeEach(async () => {
    loansRepository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto: Partial<Loan>) => dto),
      save: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    installmentsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto: Partial<Installment>) => dto),
      save: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    paymentsRepository = {
      // Bug fix, 2026-09-07 — defaults to no payments found, so
      // summarize()/findOne()'s new sumPaymentsByInstallmentId call has
      // something iterable rather than undefined in every test that
      // doesn't care about partial-payment scenarios and so never sets
      // this itself.
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto: Partial<Payment>) => dto),
      save: jest.fn((payments: unknown[]) => Promise.resolve(payments)),
      count: jest.fn(),
    };
    paymentImagesRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    loanInstallmentConceptsRepository = {
      create: jest.fn((dto: Partial<LoanInstallmentConcept>) => dto),
      save: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    interestConceptTypesService = {
      findOneOrThrow: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(
            id === mockMoratoryConceptType.id
              ? mockMoratoryConceptType
              : mockConceptType,
          ),
        ),
    };
    // Default: a valid, non-stale current-month rate — every pre-existing
    // test below implicitly depends on loan creation/preview succeeding
    // (Phase 24 hard-blocks otherwise, see getCurrentUsuryRateOrThrow).
    // Tests that specifically exercise the missing/stale-rate block or the
    // percentage-auto-fill rule override this.
    usuryRateService = {
      getCurrentRate: jest.fn().mockResolvedValue({
        id: 'rate-1',
        effectiveMonth: '2026-08-01',
        ratePercentage: 20,
        createdBy: null,
        createdByUser: null,
        createdAt: new Date(),
        isStale: false,
      }),
    };
    // Default: no mora block, no cupo configured (creditAvailable: null
    // means unrestricted — see ClientsService.getCreditUsage) — so every
    // pre-existing test below, which doesn't care about Phase 10 at all,
    // keeps passing unaffected. Tests that DO care override these.
    clientsService = {
      hasMoraBlock: jest.fn().mockResolvedValue(false),
      getCreditUsage: jest.fn().mockResolvedValue({
        creditLimit: null,
        creditUsed: 0,
        creditAvailable: null,
      }),
      // Phase 26 — only exercised by tests that actually set a
      // coDebtorClientId; assertCoDebtorIsValid() short-circuits on a
      // falsy coDebtorClientId, so the rest of the suite never calls
      // these. findByIdIncludingDeleted is only used by findOne() (the
      // read path), unrelated to write-time validation.
      findOne: jest.fn().mockResolvedValue({ id: 'co-debtor-1' }),
      findByIdIncludingDeleted: jest.fn().mockResolvedValue(null),
    };
    // Reverted, 2026-09-06 — create()/refinance() call this synchronously
    // again (see loans.service.ts's own comment on the revert). Resolves
    // by default so tests that don't care about messaging aren't affected;
    // tests below assert on whether/how it's called.
    newLoanReminderService = {
      sendNewLoanMessage: jest.fn().mockResolvedValue(undefined),
    };
    // Mock manager.getRepository() routes to the same mock repositories
    // above by entity class, so persistLoanWithInstallments (now run
    // inside dataSource.transaction()) exercises the exact mocks every
    // existing assertion already targets — see loans.service.ts's
    // create()/refinance() transaction wrapping.
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          async (work: (manager: EntityManager) => Promise<unknown>) => {
            const manager = {
              getRepository: (entity: unknown) => {
                if (entity === Loan) return loansRepository;
                if (entity === Installment) return installmentsRepository;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: paymentsRepository,
        },
        {
          provide: getRepositoryToken(PaymentImage),
          useValue: paymentImagesRepository,
        },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
        },
        {
          provide: InterestConceptTypesService,
          useValue: interestConceptTypesService,
        },
        {
          provide: UsuryRateService,
          useValue: usuryRateService,
        },
        { provide: ClientsService, useValue: clientsService },
        {
          provide: NewLoanReminderService,
          useValue: newLoanReminderService,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
  });

  describe('create', () => {
    const createDto = {
      clientId: 'client-1',
      promissoryNoteNumber: '#900',
      principalAmount: 900000,
      interestRate: 6,
      disbursedAt: '2026-01-01',
      installmentFrequency: InstallmentFrequency.Monthly,
      totalInstallments: 3,
      // No optional catalog fees — corriente/moratorio interest is now
      // system-generated (see resolveConceptsWithInterest), defaulting to
      // the mocked usury ceiling below (20%), so amounts asserted in the
      // tests below are unchanged from before the redesign.
      concepts: [],
      moratoryConcepts: [],
      description: 'Compra de televisor',
    };

    beforeEach(() => {
      loansRepository.findOne.mockResolvedValue(null);
      loansRepository.save.mockResolvedValue({ ...mockLoan, id: 'loan-2' });
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        id: 'loan-2',
      });
      installmentsRepository.find.mockResolvedValue([]);
      installmentsRepository.save.mockImplementation(
        (installments: Partial<Installment>[]) =>
          Promise.resolve(
            installments.map((installment, index) => ({
              ...installment,
              id: `installment-${index + 1}`,
            })),
          ),
      );
    });

    it('generates one installment per amount with sequential numbers and monthly due dates', async () => {
      await service.create(createDto);

      // Capital fijo — 900000/3 = 300000 principal every installment.
      // Corriente interest (defaults to the mocked 20% usury ceiling) on
      // the true declining balance (900000, 600000, 300000) would be
      // 180000/120000/60000 — but confirmed with the human 2026-09-04
      // (matching the client's Excel): those get averaged into one flat
      // "cuota con interés" of 120000 every installment
      // ((180000+120000+60000)/3), rounded to the nearest $1,000 (already
      // exact here). So every installment totals 420000, not a declining
      // 480000/420000/360000.
      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentNumber: 1,
          amount: 420000,
          principalPortion: 300000,
          dueDate: '2026-02-01',
        }),
        expect.objectContaining({
          installmentNumber: 2,
          amount: 420000,
          principalPortion: 300000,
          dueDate: '2026-03-01',
        }),
        expect.objectContaining({
          installmentNumber: 3,
          amount: 420000,
          principalPortion: 300000,
          dueDate: '2026-04-01',
        }),
      ]);
    });

    it('spaces due dates two weeks apart for biweekly loans', async () => {
      await service.create({
        ...createDto,
        installmentFrequency: InstallmentFrequency.Biweekly,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ dueDate: '2026-01-15' }),
        expect.objectContaining({ dueDate: '2026-01-29' }),
        expect.objectContaining({ dueDate: '2026-02-12' }),
      ]);
    });

    it('persists totalInstallments from the request', async () => {
      await service.create(createDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalInstallments: 3 }),
      );
    });

    // Phase 26 — optional co-debtor (codeudor), an existing client linked
    // by id, validated by assertCoDebtorIsValid before being passed
    // through to persistLoanWithInstallments. See
    // docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
    it('persists the co-debtor fields when the dto includes one', async () => {
      await service.create({
        ...createDto,
        coDebtorClientId: 'co-debtor-1',
        coDebtorRelationship: 'Hermano del deudor',
      });

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coDebtorClientId: 'co-debtor-1',
          coDebtorRelationship: 'Hermano del deudor',
        }),
      );
    });

    it('persists null co-debtor fields when the dto omits one', async () => {
      await service.create(createDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coDebtorClientId: null,
          coDebtorRelationship: null,
        }),
      );
      expect(clientsService.findOne).not.toHaveBeenCalled();
    });

    it("rejects when coDebtorClientId is the same as the loan's own clientId", async () => {
      await expect(
        service.create({
          ...createDto,
          coDebtorClientId: createDto.clientId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when coDebtorClientId does not reference an existing, active client', async () => {
      clientsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({
          ...createDto,
          coDebtorClientId: 'missing-client',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // Loan + installments + concept rows are three sequential saves — a
    // real incident (2026-08-18) found refinance() left the DB in a broken
    // half-applied state when one of them failed. Both create() and
    // refinance() must run through dataSource.transaction() so a failure
    // partway rolls everything back.
    it('runs persistence inside a transaction', async () => {
      await service.create(createDto);

      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('rejects a duplicate promissory note number', async () => {
      loansRepository.findOne.mockResolvedValue(mockLoan);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    // Relaxed 2026-09-07 (confirmed with the human) — a number is only
    // blocked while it belongs to a loan TypeORM's default (non-deleted)
    // query can still see. No `withDeleted: true` here means a soft-deleted
    // loan's number (see LoansService.remove(), which only ever soft-deletes
    // a loan with zero payments registered) is no longer permanently
    // reserved — see assertPromissoryNoteNumberIsUnique's own comment for
    // why this can never let two loans be simultaneously active under the
    // same number.
    it('checks uniqueness without withDeleted, so a soft-deleted loan no longer permanently reserves its number', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await service.create(createDto);

      expect(loansRepository.findOne).toHaveBeenCalledWith({
        where: { promissoryNoteNumber: createDto.promissoryNoteNumber },
      });
    });

    // Phase 24 — a loan cannot be created at all without the current
    // month's usury rate on file (hard block, replacing Phase 15's
    // warning-only model).
    it('rejects loan creation when no usury rate is on file', async () => {
      usuryRateService.getCurrentRate.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it('rejects loan creation when the most recent usury rate is stale (a prior month)', async () => {
      usuryRateService.getCurrentRate.mockResolvedValue({
        id: 'rate-1',
        effectiveMonth: '2026-07-01',
        ratePercentage: 20,
        createdBy: null,
        createdByUser: null,
        createdAt: new Date(),
        isStale: true,
      });

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    // Redesign, 2026-09-03 — corrienteInterestRate is used as-is, as long
    // as it's within the usury ceiling; a discount below the legal max is
    // a legitimate business choice, only going over it is blocked (see
    // the reject test in "system-generated interest field" below).
    it("uses the request's own corrienteInterestRate when it's below the usury ceiling, instead of forcing it to the ceiling", async () => {
      await service.create({
        ...createDto,
        corrienteInterestRate: 5,
      });

      const calls = loanInstallmentConceptsRepository.save.mock
        .calls as unknown[][];
      const savedRows = calls[0][0] as Array<{
        value: number;
        category: ConceptCategory;
      }>;
      const corrienteRows = savedRows.filter(
        (row) => row.category === ConceptCategory.Corriente,
      );
      expect(corrienteRows.length).toBeGreaterThan(0);
      expect(corrienteRows.every((row) => row.value === 5)).toBe(true);
    });

    it('propagates NotFoundException when a concept references an unknown concept type', async () => {
      interestConceptTypesService.findOneOrThrow.mockRejectedValue(
        new NotFoundException(
          'Interest concept type with id missing not found',
        ),
      );

      await expect(
        service.create({
          ...createDto,
          concepts: [
            ...createDto.concepts,
            {
              conceptTypeId: 'missing',
              calculationType: ConceptCalculationType.Percentage,
              value: 2,
            },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it('persists a system-generated LoanInstallmentConcept row per installment, with its computed amount', async () => {
      // Ceiling matches the default (omitted) rate so this test's own
      // arithmetic stays unaffected by the rate under test above.
      usuryRateService.getCurrentRate.mockResolvedValue({
        id: 'rate-1',
        effectiveMonth: '2026-08-01',
        ratePercentage: 2,
        createdBy: null,
        createdByUser: null,
        createdAt: new Date(),
        isStale: false,
      });

      await service.create(createDto);

      // Interleaved corriente/moratorio per installment — both
      // system-generated (interestConceptTypeId: null), moratorio always
      // computedAmount: 0 (never baked into installment.amount, see
      // persistLoanWithInstallments). Corriente's true declining values
      // (900000/600000/300000 balances * 2% = 18000/12000/6000) are
      // averaged into one flat 12000 every installment — confirmed with
      // the human 2026-09-04, same "cuota con interés" smoothing as the
      // installment totals above.
      expect(loanInstallmentConceptsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentId: 'installment-1',
          interestConceptTypeId: null,
          nameSnapshot: 'Intereses corrientes',
          calculationType: ConceptCalculationType.Percentage,
          value: 2,
          computedAmount: 12000, // (18000+12000+6000)/3
        }),
        expect.objectContaining({
          installmentId: 'installment-1',
          interestConceptTypeId: null,
          nameSnapshot: 'Intereses moratorios',
          computedAmount: 0,
        }),
        expect.objectContaining({
          installmentId: 'installment-2',
          nameSnapshot: 'Intereses corrientes',
          computedAmount: 12000,
        }),
        expect.objectContaining({
          installmentId: 'installment-2',
          nameSnapshot: 'Intereses moratorios',
          computedAmount: 0,
        }),
        expect.objectContaining({
          installmentId: 'installment-3',
          nameSnapshot: 'Intereses corrientes',
          computedAmount: 12000,
        }),
        expect.objectContaining({
          installmentId: 'installment-3',
          nameSnapshot: 'Intereses moratorios',
          computedAmount: 0,
        }),
      ]);
    });

    // Redesign, 2026-09-03 — the down payment ("cuota inicial") is now a
    // real, interest-free installment (installmentNumber 1), not a purely
    // informational field on the loan. Supersedes the Phase 13 model —
    // see docs/phases/PHASE_13_INITIAL_INSTALLMENT.md for that.
    describe('down payment ("cuota inicial")', () => {
      it('rejects when downPaymentAmount is given without downPaymentDueDate', async () => {
        await expect(
          service.create({ ...createDto, downPaymentAmount: 1000000 }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('rejects when downPaymentDueDate is given without downPaymentAmount', async () => {
        await expect(
          service.create({ ...createDto, downPaymentDueDate: '2026-01-15' }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      // createDto's disbursedAt ('2026-01-01') + monthly puts the schedule's
      // own first (unshifted) installment on '2026-02-01' — see the "one
      // installment per amount" test above. The down payment must land
      // strictly before that.
      it('rejects a downPaymentDueDate on or after the second installment due date', async () => {
        await expect(
          service.create({
            ...createDto,
            downPaymentAmount: 1000000,
            downPaymentDueDate: '2026-02-01',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('prepends the down payment as an interest-free installmentNumber 1, renumbers the rest, and keeps their original due dates', async () => {
        await service.create({
          ...createDto,
          downPaymentAmount: 1000000,
          downPaymentDueDate: '2026-01-15',
        });

        expect(installmentsRepository.save).toHaveBeenCalledWith([
          expect.objectContaining({
            installmentNumber: 1,
            amount: 1000000,
            principalPortion: 1000000,
            dueDate: '2026-01-15',
            isDownPayment: true,
          }),
          expect.objectContaining({
            installmentNumber: 2,
            dueDate: '2026-02-01', // schedule's own unshifted installment 1
            isDownPayment: false,
          }),
          expect.objectContaining({
            installmentNumber: 3,
            dueDate: '2026-03-01',
            isDownPayment: false,
          }),
          expect.objectContaining({
            installmentNumber: 4,
            dueDate: '2026-04-01',
            isDownPayment: false,
          }),
        ]);
      });

      it('increments the persisted totalInstallments by one to count the down payment', async () => {
        await service.create({
          ...createDto,
          downPaymentAmount: 1000000,
          downPaymentDueDate: '2026-01-15',
        });

        expect(loansRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({ totalInstallments: 4 }),
        );
      });

      it('does not change totalInstallments or installment numbering when there is no down payment', async () => {
        await service.create(createDto);

        expect(loansRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({ totalInstallments: 3 }),
        );
        expect(installmentsRepository.save).toHaveBeenCalledWith([
          expect.objectContaining({
            installmentNumber: 1,
            isDownPayment: false,
          }),
          expect.objectContaining({
            installmentNumber: 2,
            isDownPayment: false,
          }),
          expect.objectContaining({
            installmentNumber: 3,
            isDownPayment: false,
          }),
        ]);
      });

      it('never generates a corriente concept row for the down payment, but does generate moratory rows for it when the loan has moratory concepts', async () => {
        await service.create({
          ...createDto,
          downPaymentAmount: 1000000,
          downPaymentDueDate: '2026-01-15',
          moratoryConcepts: [
            {
              conceptTypeId: mockMoratoryConceptType.id,
              calculationType: ConceptCalculationType.Percentage,
              value: 3,
            },
          ],
        });

        const calls = loanInstallmentConceptsRepository.save.mock
          .calls as unknown[][];
        const savedRows = calls[0][0] as Array<{
          installmentId: string;
          category: ConceptCategory;
        }>;
        const downPaymentRows = savedRows.filter(
          (row) => row.installmentId === 'installment-1',
        );

        expect(
          downPaymentRows.every(
            (row) => row.category === ConceptCategory.Moratorio,
          ),
        ).toBe(true);
        expect(downPaymentRows.length).toBeGreaterThan(0);
      });
    });

    it('defaults isNewLoan to false when the dto omits it', async () => {
      await service.create(createDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isNewLoan: false }),
      );
    });

    it('persists isNewLoan: true when the dto sets it', async () => {
      await service.create({ ...createDto, isNewLoan: true });

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isNewLoan: true }),
      );
    });

    // Reverted, 2026-09-06 (confirmed with the human) — back to sending
    // synchronously right from create(), same as before the short-lived
    // cron-sweep redesign. See loans.service.ts's own comment on why.
    it('does not send a new-loan WhatsApp message when isNewLoan is false (the default)', async () => {
      await service.create(createDto);

      expect(newLoanReminderService.sendNewLoanMessage).not.toHaveBeenCalled();
    });

    it('sends the new-loan WhatsApp message synchronously when isNewLoan is true', async () => {
      loansRepository.save.mockResolvedValue({
        ...mockLoan,
        id: 'loan-2',
        isNewLoan: true,
      });

      await service.create({ ...createDto, isNewLoan: true });

      expect(newLoanReminderService.sendNewLoanMessage).toHaveBeenCalledWith(
        'loan-2',
      );
    });

    it('does not let a failed new-loan message send block loan creation', async () => {
      loansRepository.save.mockResolvedValue({
        ...mockLoan,
        id: 'loan-2',
        isNewLoan: true,
      });
      newLoanReminderService.sendNewLoanMessage.mockRejectedValue(
        new Error('WhatsApp API down'),
      );

      await expect(
        service.create({ ...createDto, isNewLoan: true }),
      ).resolves.toBeDefined();
    });

    // Phase 10 — docs/phases/PHASE_10_CLIENT_CAPACITY.md's cupo/mora-block
    // guard. Mora-block is checked first and reported as a distinct reason
    // from "over cupo" — both are asserted below.
    it('rejects when the client is mora-blocked, even with cupo available', async () => {
      clientsService.hasMoraBlock.mockResolvedValue(true);

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it("rejects when the principal exceeds the client's available cupo", async () => {
      clientsService.getCreditUsage.mockResolvedValue({
        creditLimit: 500000,
        creditUsed: 200000,
        creditAvailable: 300000, // less than createDto's 900000 principal
      });

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it('reports mora-block and over-cupo as distinct error messages', async () => {
      clientsService.hasMoraBlock.mockResolvedValue(true);
      let moraMessage = '';
      try {
        await service.create(createDto);
      } catch (error) {
        moraMessage = (error as BadRequestException).message;
      }

      clientsService.hasMoraBlock.mockResolvedValue(false);
      clientsService.getCreditUsage.mockResolvedValue({
        creditLimit: 500000,
        creditUsed: 500000,
        creditAvailable: 0,
      });
      let cupoMessage = '';
      try {
        await service.create(createDto);
      } catch (error) {
        cupoMessage = (error as BadRequestException).message;
      }

      expect(moraMessage).not.toBe('');
      expect(cupoMessage).not.toBe('');
      expect(moraMessage).not.toBe(cupoMessage);
    });

    it('allows the loan when within cupo and not mora-blocked', async () => {
      clientsService.hasMoraBlock.mockResolvedValue(false);
      clientsService.getCreditUsage.mockResolvedValue({
        creditLimit: 2000000,
        creditUsed: 0,
        creditAvailable: 2000000,
      });

      const result = await service.create(createDto);

      expect(result.id).toBe('loan-2');
      expect(loansRepository.save).toHaveBeenCalled();
    });

    it('allows the loan regardless of principal when the client has no cupo configured', async () => {
      clientsService.getCreditUsage.mockResolvedValue({
        creditLimit: null,
        creditUsed: 0,
        creditAvailable: null,
      });

      const result = await service.create(createDto);

      expect(result.id).toBe('loan-2');
    });

    it("checks mora-block and cupo for the loan's clientId", async () => {
      await service.create(createDto);

      expect(clientsService.hasMoraBlock).toHaveBeenCalledWith('client-1');
      expect(clientsService.getCreditUsage).toHaveBeenCalledWith('client-1');
    });

    // Redesign, 2026-09-03 — corrienteInterestRate/moratoryInterestRate
    // default to, and are capped at, the current usury ceiling (20% in
    // the default beforeEach mock). "Editable solo hacia abajo" —
    // confirmed with the human.
    describe('system-generated interest field', () => {
      it('defaults corrienteInterestRate/moratoryInterestRate to the usury ceiling when omitted', async () => {
        await service.create(createDto);

        const calls = loanInstallmentConceptsRepository.save.mock
          .calls as unknown[][];
        const savedRows = calls[0][0] as Array<{ value: number }>;
        expect(savedRows.every((row) => row.value === 20)).toBe(true);
      });

      it('rejects when corrienteInterestRate exceeds the usury ceiling', async () => {
        await expect(
          service.create({ ...createDto, corrienteInterestRate: 25 }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('rejects when moratoryInterestRate exceeds the usury ceiling', async () => {
        await expect(
          service.create({ ...createDto, moratoryInterestRate: 25 }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('allows a moratoryInterestRate exactly at the usury ceiling', async () => {
        const result = await service.create({
          ...createDto,
          moratoryInterestRate: 20,
        });

        expect(result.id).toBe('loan-2');
      });
    });
  });

  describe('refinance', () => {
    // Redesign, 2026-09-06 — the dto no longer accepts promissoryNoteNumber
    // (see RefinanceLoanDto's own comment): the new loan always keeps the
    // OLD loan's own number ('#743', from mockLoan above) instead of being
    // assigned one of its own.
    const refinanceDto = {
      principalAmount: 600000,
      interestRate: 5,
      disbursedAt: '2026-07-10',
      installmentFrequency: InstallmentFrequency.Monthly,
      totalInstallments: 2,
      // No optional catalog fees — see createDto's own comment above.
      concepts: [],
      moratoryConcepts: [],
    };

    const newLoanRecord: Loan = {
      ...mockLoan,
      id: 'loan-2',
      promissoryNoteNumber: mockLoan.promissoryNoteNumber,
      principalAmount: 600000,
      interestRate: 5,
      totalInstallments: 2,
      refinancedFromLoanId: mockLoan.id,
    };

    beforeEach(() => {
      loansRepository.findOneBy
        .mockResolvedValueOnce({ ...mockLoan }) // old loan lookup — cloned, refinance() mutates .status in place
        .mockResolvedValueOnce(newLoanRecord); // findOne(newLoan.id) at the end
      // Only the reverse lookup inside the final this.findOne(newLoan.id)
      // call hits loansRepository.findOne during a refinance now — the
      // promissory-note uniqueness check is skipped entirely for the new
      // loan (see skipPromissoryNoteNumberUniquenessCheck's own comment).
      loansRepository.findOne.mockResolvedValue(null);
      loansRepository.save
        .mockImplementationOnce((loan: Loan) => Promise.resolve(loan)) // old loan status update
        .mockResolvedValueOnce(newLoanRecord); // new loan save
      installmentsRepository.find.mockResolvedValue([]);
      installmentsRepository.save.mockImplementation(
        (installments: Partial<Installment>[]) =>
          Promise.resolve(
            installments.map((installment, index) => ({
              ...installment,
              id: `installment-${index + 1}`,
            })),
          ),
      );
    });

    it('marks the old loan as refinanced and cancels its remaining pending installments', async () => {
      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: LoanStatus.Refinanced }),
      );
      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { loanId: mockLoan.id, status: InstallmentStatus.Pending },
        { status: InstallmentStatus.Cancelled },
      );
    });

    it('creates a new loan linked back to the old one with its own generated installments', async () => {
      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: mockLoan.clientId,
          refinancedFromLoanId: mockLoan.id,
          totalInstallments: 2,
        }),
      );
      // Capital fijo — 600000/2 = 300000 principal each installment. True
      // declining corriente interest (600000 then 300000 balance * 20%)
      // is 120000/60000 — averaged into a flat 90000/installment
      // ((120000+60000)/2), so both installments total 390000, not a
      // declining 420000/360000.
      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ installmentNumber: 1, amount: 390000 }),
        expect.objectContaining({ installmentNumber: 2, amount: 390000 }),
      ]);
    });

    // Business change, 2026-09-06 (confirmed with the human) — a
    // refinanced pagaré is REPLACED under the same number, not reassigned a
    // new one. The strict, all-statuses assertPromissoryNoteNumberIsUnique
    // check is deliberately NOT run against this reused number (it would
    // always find at least oldLoan itself and reject) — instead
    // persistLoanWithInstallments skips it entirely via
    // skipPromissoryNoteNumberUniquenessCheck, since the number isn't being
    // freely chosen here. create() (a genuinely new loan) never sets that
    // flag and still goes through the full strict check — see its own
    // "rejects a duplicate promissory note number" test above, unaffected
    // by this change.
    it("reuses the old loan's own promissory note number on the new loan, instead of accepting one from the dto or validating it as free", async () => {
      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          promissoryNoteNumber: mockLoan.promissoryNoteNumber,
        }),
      );
      // Only the reverse-lookup findOne (inside the closing this.findOne())
      // runs — never one with a promissoryNoteNumber filter.
      expect(loansRepository.findOne).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            promissoryNoteNumber: expect.anything() as unknown,
          }) as unknown,
        }),
      );
    });

    // Closing out the old loan, cancelling its installments, and creating
    // the new one must all succeed or all roll back — see the same note
    // on create()'s "runs persistence inside a transaction" test.
    it('runs the whole refinance inside a transaction', async () => {
      await service.refinance(mockLoan.id, refinanceDto);

      expect(dataSource.transaction).toHaveBeenCalled();
    });

    // Phase 25 (confirmed with the human, reunión 2026-08-25): the old
    // "client must be current first" rejection is gone — refinancing with
    // an overdue installment now succeeds. Superseded by the tests below;
    // this one only asserts the old BadRequestException no longer fires.
    it('no longer rejects refinancing when the old loan has an unpaid overdue installment', async () => {
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: mockLoan.id,
          loan: mockLoan,
          installmentNumber: 1,
          amount: 300000,
          principalPortion: 300000,
          dueDate: '2020-01-01', // far in the past — deterministic overdue
          status: InstallmentStatus.Pending,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]);

      await expect(
        service.refinance(mockLoan.id, refinanceDto),
      ).resolves.toBeDefined();
      expect(loansRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: LoanStatus.Refinanced }),
      );
    });

    it('allows refinancing when no installments are overdue', async () => {
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 1);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: mockLoan.id,
          loan: mockLoan,
          installmentNumber: 1,
          amount: 300000,
          principalPortion: 300000,
          dueDate: futureDueDate.toISOString().slice(0, 10),
          status: InstallmentStatus.Pending,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]);

      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.save).toHaveBeenCalled();
    });

    // Redesign, 2026-09-06 (confirmed with the human) — unlike create(),
    // refinance() no longer takes isNewLoan from the dto at all (removed
    // from RefinanceLoanDto entirely): a refinance can only ever apply to
    // a loan already active in the system, so it's always treated as a
    // real, live event and always scheduled for the "new loan" WhatsApp
    // message, regardless of what the dto sends.
    it('always sets isNewLoan: true on the new loan, even if the dto tries to override it', async () => {
      await service.refinance(mockLoan.id, {
        ...refinanceDto,
        isNewLoan: false,
      } as typeof refinanceDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isNewLoan: true }),
      );
    });

    // Reverted, 2026-09-06 (confirmed with the human) — sent synchronously
    // again right after the transaction commits, same as create(). Always
    // fires for a refinance since isNewLoan is hardcoded true above.
    it('sends the new-loan WhatsApp message synchronously for the new loan', async () => {
      await service.refinance(mockLoan.id, refinanceDto);

      expect(newLoanReminderService.sendNewLoanMessage).toHaveBeenCalledWith(
        newLoanRecord.id,
      );
    });

    it('does not let a failed new-loan message send block the refinance', async () => {
      newLoanReminderService.sendNewLoanMessage.mockRejectedValue(
        new Error('WhatsApp API down'),
      );

      await expect(
        service.refinance(mockLoan.id, refinanceDto),
      ).resolves.toBeDefined();
    });

    // Phase 26 — the new loan carries over the old loan's co-debtor by
    // default, unless the refinance dto explicitly overrides a field. See
    // docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
    it("carries over the old loan's co-debtor when the refinance dto omits it", async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy
        .mockResolvedValueOnce({
          ...mockLoan,
          coDebtorClientId: 'co-debtor-1',
          coDebtorRelationship: 'Hermano del deudor',
        })
        .mockResolvedValueOnce(newLoanRecord);

      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coDebtorClientId: 'co-debtor-1',
          coDebtorRelationship: 'Hermano del deudor',
        }),
      );
    });

    it('overrides the co-debtor field-by-field when the refinance dto provides one', async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy
        .mockResolvedValueOnce({
          ...mockLoan,
          coDebtorClientId: 'co-debtor-1',
          coDebtorRelationship: 'Hermano del deudor',
        })
        .mockResolvedValueOnce(newLoanRecord);

      await service.refinance(mockLoan.id, {
        ...refinanceDto,
        coDebtorClientId: 'co-debtor-2',
      });

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coDebtorClientId: 'co-debtor-2',
          // Untouched field still carries over from the old loan.
          coDebtorRelationship: 'Hermano del deudor',
        }),
      );
    });

    it('leaves the new loan without a co-debtor when the old loan had none and the dto omits it', async () => {
      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coDebtorClientId: null,
          coDebtorRelationship: null,
        }),
      );
    });

    // QoL fix (2026-08-30) — an explicit `null` (as opposed to omitting the
    // field) must clear the co-debtor on the new loan rather than carrying
    // the old one over, so the frontend's "tiene codeudor" checkbox actually
    // has an effect when unchecked during refinance. See
    // docs/DATABASE.md ("On the co-debtor and refinancing").
    it('clears the co-debtor when the dto explicitly sets both fields to null', async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy
        .mockResolvedValueOnce({
          ...mockLoan,
          coDebtorClientId: 'co-debtor-1',
          coDebtorRelationship: 'Hermano del deudor',
        })
        .mockResolvedValueOnce(newLoanRecord);

      await service.refinance(mockLoan.id, {
        ...refinanceDto,
        coDebtorClientId: null,
        coDebtorRelationship: null,
      });

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coDebtorClientId: null,
          coDebtorRelationship: null,
        }),
      );
      // Clearing shouldn't trigger co-debtor validation — there's no
      // client id to validate.
      expect(clientsService.findOne).not.toHaveBeenCalled();
    });

    // Redesign, 2026-09-03 — refinance() supports its own down payment on
    // the new loan the same way create() does (confirmed with the human —
    // applies to refinancing too). refinanceDto's disbursedAt ('2026-07-10')
    // + monthly puts the schedule's own first installment on '2026-08-10',
    // so the down payment must land strictly before that.
    it('prepends a down payment as installmentNumber 1 on the new loan when the refinance dto includes one', async () => {
      await service.refinance(mockLoan.id, {
        ...refinanceDto,
        downPaymentAmount: 20000,
        downPaymentDueDate: '2026-07-20',
      });

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalInstallments: 3 }),
      );
      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentNumber: 1,
          amount: 20000,
          principalPortion: 20000,
          dueDate: '2026-07-20',
          isDownPayment: true,
        }),
        expect.objectContaining({ installmentNumber: 2, isDownPayment: false }),
        expect.objectContaining({ installmentNumber: 3, isDownPayment: false }),
      ]);
    });

    // Phase 24 — same hard block and percentage-auto-fill rules as
    // create(), since both share persistLoanWithInstallments().
    it('rejects refinancing when no usury rate is on file', async () => {
      usuryRateService.getCurrentRate.mockResolvedValue(null);

      // Not asserting loansRepository.save wasn't called here — the old
      // loan's status flip to 'refinanced' happens before
      // persistLoanWithInstallments's hard block runs, within the same
      // (mocked) transaction; only the new loan is never created.
      await expect(
        service.refinance(mockLoan.id, refinanceDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses the request's own corrienteInterestRate on refinance too, instead of forcing it to the ceiling", async () => {
      await service.refinance(mockLoan.id, {
        ...refinanceDto,
        corrienteInterestRate: 5,
      });

      expect(loanInstallmentConceptsRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ value: 5 })]),
      );
    });

    it('rejects refinancing an already-paid loan', async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy.mockResolvedValueOnce({
        ...mockLoan,
        status: LoanStatus.Paid,
      });

      await expect(
        service.refinance(mockLoan.id, refinanceDto),
      ).rejects.toThrow(BadRequestException);
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it('rejects refinancing an already-refinanced loan', async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy.mockResolvedValueOnce({
        ...mockLoan,
        status: LoanStatus.Refinanced,
      });

      await expect(
        service.refinance(mockLoan.id, refinanceDto),
      ).rejects.toThrow(BadRequestException);
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy.mockResolvedValueOnce(null);

      await expect(
        service.refinance('missing-id', refinanceDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns the loan with calculated fields on each installment', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      const overdueInstallment: Installment = {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: undefined as never,
        installmentNumber: 1,
        amount: 210000,
        principalPortion: null,
        dueDate: '2024-01-01', // far in the past — deterministic overdue
        status: InstallmentStatus.Pending,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      const paidInstallment: Installment = {
        ...overdueInstallment,
        id: 'inst-2',
        installmentNumber: 2,
        status: InstallmentStatus.Paid,
      };
      installmentsRepository.find.mockResolvedValue([
        overdueInstallment,
        paidInstallment,
      ]);

      const result = await service.findOne(mockLoan.id);

      expect(result.installments[0].overdueDays).toBeGreaterThan(0);
      expect(result.installments[0].interest).toBeGreaterThan(0);
      expect(result.installments[1]).toMatchObject({
        overdueDays: 0,
        interest: 0,
        totalDue: 0,
      });
    });

    // Bug fix, 2026-09-07 (human report, préstamo #0920) — this is what the
    // register-payment dialog reads for its "Saldo" header and pre-filled
    // amount. Before this fix, a partially paid Pending installment's
    // totalDue never netted out what was already paid, so the dialog kept
    // re-offering the cuota's full original amount as if nothing had been
    // paid — which is what let a second payment exceed the real balance.
    it("nets out an existing partial payment from a pending installment's totalDue", async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      const partiallyPaidInstallment: Installment = {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: undefined as never,
        installmentNumber: 1,
        amount: 850000,
        principalPortion: null,
        dueDate: '2099-01-01', // not overdue — deterministic totalDue
        status: InstallmentStatus.Pending,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      installmentsRepository.find.mockResolvedValue([partiallyPaidInstallment]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 800000 },
      ]);

      const result = await service.findOne(mockLoan.id);

      expect(result.installments[0].totalDue).toBe(50000);
    });

    // Phase 31 — "saldo capital a la fecha" must be pure principal, no
    // interest, and only across still-pending installments.
    it('computes currentPrincipalBalance as pure principal across pending installments only', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      const overduePending: Installment = {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: undefined as never,
        installmentNumber: 1,
        amount: 210000,
        principalPortion: 200000,
        dueDate: '2024-01-01', // far in the past — deterministic overdue, accrues interest
        status: InstallmentStatus.Pending,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      const paidInstallment: Installment = {
        ...overduePending,
        id: 'inst-2',
        installmentNumber: 2,
        principalPortion: 300000,
        // Must be excluded despite having its own principalPortion — only
        // still-pending installments count toward the current balance.
        status: InstallmentStatus.Paid,
      };
      installmentsRepository.find.mockResolvedValue([
        overduePending,
        paidInstallment,
      ]);

      const result = await service.findOne(mockLoan.id);

      // Sanity check: this installment does accrue interest, so a naive
      // "sum of totalDue" would overstate the pure-principal figure.
      expect(result.installments[0].interest).toBeGreaterThan(0);
      expect(result.currentPrincipalBalance).toBe(200000);
    });

    it('attaches each installment its concept breakdown from LoanInstallmentConcept', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      const installment: Installment = {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: undefined as never,
        installmentNumber: 1,
        amount: 306000,
        principalPortion: 300000,
        dueDate: '2026-08-01',
        status: InstallmentStatus.Pending,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      installmentsRepository.find.mockResolvedValue([installment]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'inst-1',
          nameSnapshot: 'Interés remuneratorio',
          category: ConceptCategory.Corriente,
          computedAmount: 6000,
          value: 5,
          calculationType: ConceptCalculationType.Percentage,
        },
      ]);

      const result = await service.findOne(mockLoan.id);

      expect(result.installments[0].conceptBreakdown).toEqual([
        {
          name: 'Interés remuneratorio',
          amount: 6000,
          category: ConceptCategory.Corriente,
          value: 5,
          calculationType: ConceptCalculationType.Percentage,
        },
      ]);
      expect(result.installments[0].principalPortion).toBe(300000);
    });

    it('returns null refinancedToLoanId when no loan points back to this one', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      installmentsRepository.find.mockResolvedValue([]);

      const result = await service.findOne(mockLoan.id);

      expect(result.refinancedToLoanId).toBeNull();
    });

    it('returns the new loan id as refinancedToLoanId when this loan was refinanced', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue({ ...mockLoan, id: 'loan-2' });
      installmentsRepository.find.mockResolvedValue([]);

      const result = await service.findOne(mockLoan.id);

      expect(result.refinancedToLoanId).toBe('loan-2');
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    // Phase 26 — resolves coDebtorClientId into a full client record for
    // display. Uses findByIdIncludingDeleted (not findOne) so a loan whose
    // co-debtor was later deactivated still renders. See
    // docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
    it("resolves the loan's co-debtor client when coDebtorClientId is set", async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        coDebtorClientId: 'co-debtor-1',
      });
      loansRepository.findOne.mockResolvedValue(null);
      installmentsRepository.find.mockResolvedValue([]);
      clientsService.findByIdIncludingDeleted.mockResolvedValue({
        id: 'co-debtor-1',
        firstName: 'Carlos',
        lastName: 'Gómez',
      });

      const result = await service.findOne(mockLoan.id);

      expect(clientsService.findByIdIncludingDeleted).toHaveBeenCalledWith(
        'co-debtor-1',
      );
      expect(result.coDebtorClient).toEqual({
        id: 'co-debtor-1',
        firstName: 'Carlos',
        lastName: 'Gómez',
      });
    });

    it('returns a null coDebtorClient without querying ClientsService when the loan has no co-debtor', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      installmentsRepository.find.mockResolvedValue([]);

      const result = await service.findOne(mockLoan.id);

      expect(result.coDebtorClient).toBeNull();
      expect(clientsService.findByIdIncludingDeleted).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      installmentsRepository.find.mockResolvedValue([]);
    });

    it('returns a paginated page and applies clientId/status filters', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      const result = await service.findAll({
        clientId: 'client-1',
        status: LoanStatus.Active,
      });

      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: 'loan-1',
            clientFullName: 'Juana Pérez',
            outstandingBalance: 0,
            installmentsPaid: 0,
            overdueDays: 0,
          }),
        ],
        // limit 50 since 2026-09-05's default-page-size bump (style cleanup —
        // matches clients.service.ts's DEFAULT_PAGE_SIZE).
        meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
      expect(loansRepository.find).toHaveBeenCalledWith({
        where: { clientId: 'client-1', status: LoanStatus.Active },
        relations: { client: true },
      });
    });

    it('applies the search term as an OR across client name and promissory note number', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      await service.findAll({ search: 'Juana' });

      const [[callArg]] = loansRepository.find.mock.calls as [
        [
          {
            where: Array<{
              client?: { firstName?: unknown; lastName?: unknown };
              promissoryNoteNumber?: unknown;
            }>;
          },
        ],
      ];
      expect(callArg.where).toHaveLength(3);
      const operators = callArg.where.map(
        (condition) =>
          condition.client?.firstName ??
          condition.client?.lastName ??
          condition.promissoryNoteNumber,
      );
      for (const operator of operators) {
        expect(operator).toMatchObject({ _type: 'ilike', _value: '%Juana%' });
      }
    });

    it('returns an empty page when there are no matches', async () => {
      loansRepository.find.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result.items).toEqual([]);
      expect(result.meta.totalPages).toBe(0);
      expect(installmentsRepository.find).not.toHaveBeenCalled();
    });

    it('hides a loan whose client was soft-deleted instead of throwing', async () => {
      const orphanedLoan = { ...mockLoan, id: 'loan-orphan', client: null };
      loansRepository.find.mockResolvedValue([mockLoan, orphanedLoan]);

      const result = await service.findAll({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('loan-1');
      expect(result.meta.total).toBe(1);
    });

    it('sorts loans by the numeric part of their promissory note number', async () => {
      const loan101 = {
        ...mockLoan,
        id: 'loan-101',
        promissoryNoteNumber: '#101',
      };
      const loan2 = { ...mockLoan, id: 'loan-2', promissoryNoteNumber: '#2' };
      const loan20 = {
        ...mockLoan,
        id: 'loan-20',
        promissoryNoteNumber: '#20',
      };
      loansRepository.find.mockResolvedValue([loan101, loan2, loan20]);

      const result = await service.findAll({});

      expect(result.items.map((loan) => loan.id)).toEqual([
        'loan-2',
        'loan-20',
        'loan-101',
      ]);
    });

    it('aggregates outstandingBalance, installmentsPaid, and overdueDays from installments', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-1',
          loanId: 'loan-1',
          installmentNumber: 1,
          amount: 300000,
          dueDate: bogotaTodayPlusDays(-10),
          status: InstallmentStatus.Pending,
        },
        {
          id: 'installment-2',
          loanId: 'loan-1',
          installmentNumber: 2,
          amount: 300000,
          dueDate: '2025-01-01',
          status: InstallmentStatus.Paid,
        },
      ]);

      const [summary] = (await service.findAll({})).items;

      expect(summary.installmentsPaid).toBe(1);
      expect(summary.overdueDays).toBe(10);
      // Pending installment: amount + interest (6% / 30 * 10 days * 300000)
      expect(summary.outstandingBalance).toBeCloseTo(306000, 0);
    });

    it('sets nextInstallmentDueDate to the oldest pending installment, whether overdue or upcoming', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-1',
          loanId: 'loan-1',
          installmentNumber: 1,
          amount: 300000,
          dueDate: '2026-08-15',
          status: InstallmentStatus.Pending,
        },
        {
          id: 'installment-2',
          loanId: 'loan-1',
          installmentNumber: 2,
          amount: 300000,
          dueDate: '2026-09-15',
          status: InstallmentStatus.Pending,
        },
        {
          id: 'installment-3',
          loanId: 'loan-1',
          installmentNumber: 3,
          amount: 300000,
          dueDate: '2026-07-15',
          status: InstallmentStatus.Paid,
        },
      ]);

      const [summary] = (await service.findAll({})).items;

      // Oldest PENDING due date wins — the earlier Paid one (07-15) is
      // excluded even though its date is smaller.
      expect(summary.nextInstallmentDueDate).toBe('2026-08-15');
    });

    it('sets nextInstallmentDueDate to null when no installments are pending', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-1',
          loanId: 'loan-1',
          installmentNumber: 1,
          amount: 300000,
          dueDate: '2026-07-15',
          status: InstallmentStatus.Paid,
        },
      ]);

      const [summary] = (await service.findAll({})).items;

      expect(summary.nextInstallmentDueDate).toBeNull();
    });

    it('sets overdueBalance to only the overdue installments, unlike outstandingBalance which includes upcoming ones too', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-1',
          loanId: 'loan-1',
          installmentNumber: 1,
          amount: 300000,
          dueDate: bogotaTodayPlusDays(-10),
          status: InstallmentStatus.Pending,
        },
        {
          id: 'installment-2',
          loanId: 'loan-1',
          installmentNumber: 2,
          amount: 300000,
          dueDate: bogotaTodayPlusDays(20),
          status: InstallmentStatus.Pending,
        },
      ]);

      const [summary] = (await service.findAll({})).items;

      // Only installment-1 (the overdue one): 300000 + interest (6% / 30 *
      // 10 days * 300000) = 306000. installment-2 is pending but NOT
      // overdue, so it's excluded here even though outstandingBalance
      // includes it.
      expect(summary.overdueBalance).toBeCloseTo(306000, 0);
      expect(summary.outstandingBalance).toBeCloseTo(606000, 0);
    });

    it('sets overdueBalance to 0 when nothing is overdue', async () => {
      loansRepository.find.mockResolvedValue([mockLoan]);

      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-1',
          loanId: 'loan-1',
          installmentNumber: 1,
          amount: 300000,
          dueDate: '2099-01-01',
          status: InstallmentStatus.Pending,
        },
      ]);

      const [summary] = (await service.findAll({})).items;

      expect(summary.overdueBalance).toBe(0);
    });
  });

  // Style cleanup (2026-09-03) — see loans.service.ts's own comment above
  // getNextPromissoryNoteNumber for the full reasoning (standardizing new
  // pagarés to #0000, historical rows left untouched).
  describe('getNextPromissoryNoteNumber', () => {
    it('suggests one past the highest numeric part found, #0000-padded', async () => {
      loansRepository.find.mockResolvedValue([
        { ...mockLoan, promissoryNoteNumber: '#743' },
        { ...mockLoan, promissoryNoteNumber: '#1190' },
        { ...mockLoan, promissoryNoteNumber: '124' },
      ]);

      const result = await service.getNextPromissoryNoteNumber();

      expect(result).toEqual({ nextPromissoryNoteNumber: '#1191' });
    });

    it('pads to 4 digits when every existing number is small', async () => {
      loansRepository.find.mockResolvedValue([
        { ...mockLoan, promissoryNoteNumber: '#6' },
        { ...mockLoan, promissoryNoteNumber: '#2' },
      ]);

      const result = await service.getNextPromissoryNoteNumber();

      expect(result).toEqual({ nextPromissoryNoteNumber: '#0007' });
    });

    it('starts at #0001 when there are no loans at all', async () => {
      loansRepository.find.mockResolvedValue([]);

      const result = await service.getNextPromissoryNoteNumber();

      expect(result).toEqual({ nextPromissoryNoteNumber: '#0001' });
    });

    it('includes soft-deleted loans, so a deleted number is never reused', async () => {
      loansRepository.find.mockResolvedValue([
        { ...mockLoan, promissoryNoteNumber: '#1190' },
      ]);

      await service.getNextPromissoryNoteNumber();

      expect(loansRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });
  });

  describe('previewSchedule', () => {
    it('returns the generated schedule without persisting anything', async () => {
      // Ceiling matches the omitted rate fields' default so this test's
      // own arithmetic stays simple.
      usuryRateService.getCurrentRate.mockResolvedValue({
        id: 'rate-1',
        effectiveMonth: '2026-08-01',
        ratePercentage: 2,
        createdBy: null,
        createdByUser: null,
        createdAt: new Date(),
        isStale: false,
      });

      const result = await service.previewSchedule({
        principalAmount: 900000,
        disbursedAt: '2026-01-01',
        installmentFrequency: InstallmentFrequency.Monthly,
        totalInstallments: 3,
        concepts: [],
        moratoryConcepts: [],
      });

      // Capital fijo — 900000/3 = 300000 principal every installment.
      // True declining corriente interest at the mocked 2% ceiling
      // (18000/12000/6000 on balances 900000/600000/300000) is averaged
      // into a flat 12000 every installment, so all three total 312000,
      // not a declining 318000/312000/306000.
      expect(result.installments).toEqual([
        expect.objectContaining({
          installmentNumber: 1,
          dueDate: '2026-02-01',
          principalPortion: 300000,
          amount: 312000,
          conceptBreakdown: [
            {
              name: 'Intereses corrientes',
              amount: 12000,
              category: ConceptCategory.Corriente,
            },
            {
              name: 'Intereses moratorios',
              amount: 0,
              category: ConceptCategory.Moratorio,
            },
          ],
        }),
        expect.objectContaining({
          installmentNumber: 2,
          amount: 312000,
        }),
        expect.objectContaining({
          installmentNumber: 3,
          amount: 312000,
        }),
      ]);
      expect(loansRepository.save).not.toHaveBeenCalled();
      expect(installmentsRepository.save).not.toHaveBeenCalled();
      expect(loanInstallmentConceptsRepository.save).not.toHaveBeenCalled();
    });

    // Phase 24 — preview must apply the same hard block and auto-fill
    // rules as create()/refinance(), so what's previewed always matches
    // what a real submit would persist.
    it('rejects the preview when no usury rate is on file', async () => {
      usuryRateService.getCurrentRate.mockResolvedValue(null);

      await expect(
        service.previewSchedule({
          principalAmount: 900000,
          disbursedAt: '2026-01-01',
          installmentFrequency: InstallmentFrequency.Monthly,
          totalInstallments: 1,
          concepts: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses the request's own corrienteInterestRate/moratoryInterestRate in the preview, instead of forcing them to the ceiling", async () => {
      const result = await service.previewSchedule({
        principalAmount: 900000,
        disbursedAt: '2026-01-01',
        installmentFrequency: InstallmentFrequency.Monthly,
        totalInstallments: 1,
        concepts: [],
        moratoryConcepts: [],
        corrienteInterestRate: 5,
        moratoryInterestRate: 5,
      });

      // The requested 5% is used as-is (below the default beforeEach
      // ceiling of 20%) — no longer forced up to the ceiling.
      expect(result.installments[0].conceptBreakdown).toEqual([
        {
          name: 'Intereses corrientes',
          amount: 45000,
          category: ConceptCategory.Corriente,
        },
        {
          name: 'Intereses moratorios',
          amount: 0,
          category: ConceptCategory.Moratorio,
        },
      ]);
    });

    it('propagates NotFoundException when a concept references an unknown concept type', async () => {
      interestConceptTypesService.findOneOrThrow.mockRejectedValue(
        new NotFoundException(
          'Interest concept type with id missing not found',
        ),
      );

      await expect(
        service.previewSchedule({
          principalAmount: 900000,
          disbursedAt: '2026-01-01',
          installmentFrequency: InstallmentFrequency.Monthly,
          totalInstallments: 3,
          concepts: [
            {
              conceptTypeId: 'missing',
              calculationType: ConceptCalculationType.Percentage,
              value: 2,
            },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // Feature request, 2026-09-06 (human) — widened alongside
    // WidenConceptValuePrecision so a percentage cargo can actually be
    // stored to 4 decimals instead of silently rounding to 2. Still capped
    // at 2 for fixed_amount, since that's a plain currency figure. Exercised
    // via resolveConcepts (shared by create()/refinance()/previewSchedule())
    // — previewSchedule is the simplest surface, no persistence mocks
    // needed.
    it('rejects a percentage concept value with more than 4 decimal places', async () => {
      await expect(
        service.previewSchedule({
          principalAmount: 900000,
          disbursedAt: '2026-01-01',
          installmentFrequency: InstallmentFrequency.Monthly,
          totalInstallments: 3,
          concepts: [
            {
              conceptTypeId: mockConceptType.id,
              calculationType: ConceptCalculationType.Percentage,
              value: 2.12345,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a fixed_amount concept value with more than 2 decimal places', async () => {
      await expect(
        service.previewSchedule({
          principalAmount: 900000,
          disbursedAt: '2026-01-01',
          installmentFrequency: InstallmentFrequency.Monthly,
          totalInstallments: 3,
          concepts: [
            {
              conceptTypeId: mockConceptType.id,
              calculationType: ConceptCalculationType.FixedAmount,
              value: 15000.123,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a percentage concept value with exactly 4 decimal places', async () => {
      const result = await service.previewSchedule({
        principalAmount: 900000,
        disbursedAt: '2026-01-01',
        installmentFrequency: InstallmentFrequency.Monthly,
        totalInstallments: 3,
        concepts: [
          {
            conceptTypeId: mockConceptType.id,
            calculationType: ConceptCalculationType.Percentage,
            value: 2.1234,
          },
        ],
      });

      expect(result.installments).toHaveLength(3);
    });
  });

  describe('update', () => {
    // interestRate/moratoryConcepts were both tried as editable fields here
    // (2026-09-04) and reverted the same day — see UpdateLoanDto's own
    // comment. description is now the only scalar field PATCH /loans/:id
    // actually changes, alongside the co-debtor fields below.
    it('updates the description when the loan exists', async () => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      loansRepository.save.mockImplementation((loan: Loan) =>
        Promise.resolve(loan),
      );

      const result = await service.update(mockLoan.id, {
        description: 'Compra de televisor',
      });

      expect(result.description).toBe('Compra de televisor');
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { description: 'Compra de televisor' }),
      ).rejects.toThrow(NotFoundException);
    });

    // Phase 26 — coDebtorClientId is re-validated on update, same rules as
    // create/refinance. See docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
    it("rejects setting coDebtorClientId to the loan's own clientId", async () => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });

      await expect(
        service.update(mockLoan.id, { coDebtorClientId: mockLoan.clientId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts updating to a valid coDebtorClientId', async () => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      loansRepository.save.mockImplementation((loan: Loan) =>
        Promise.resolve(loan),
      );

      const result = await service.update(mockLoan.id, {
        coDebtorClientId: 'co-debtor-1',
      });

      expect(result.coDebtorClientId).toBe('co-debtor-1');
    });

    it('does not re-validate coDebtorClientId when the update omits it', async () => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      loansRepository.save.mockImplementation((loan: Loan) =>
        Promise.resolve(loan),
      );

      await service.update(mockLoan.id, { description: 'Compra de televisor' });

      expect(clientsService.findOne).not.toHaveBeenCalled();
    });
  });

  describe('getPayments', () => {
    it('joins across every installment of the loan, oldest payment first', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      installmentsRepository.find.mockResolvedValue([
        { id: 'installment-1' },
        { id: 'installment-2' },
      ]);
      const payments = [
        { id: 'payment-1', installmentId: 'installment-1', amountPaid: 200 },
      ];
      paymentsRepository.find.mockResolvedValue(payments);

      const result = await service.getPayments(mockLoan.id);

      // Phase 28 — getPayments() now maps each payment (imageUrl replaced
      // with imageUrls), so the result is a new array, not the same
      // reference; compare by value instead.
      expect(result).toEqual([{ ...payments[0], imageUrls: [] }]);
      expect(installmentsRepository.find).toHaveBeenCalledWith({
        where: { loanId: mockLoan.id },
        select: ['id'],
      });
      // Compared via the FindOperator's own _value rather than
      // toHaveBeenCalledWith(In([...])) — two separately-constructed
      // FindOperator instances aren't guaranteed comparable by deep
      // equality, so this checks what it actually filters by instead.
      const [[callArg]] = paymentsRepository.find.mock.calls as [
        [{ where: { installmentId: { _value: string[] } } }],
      ];
      expect(callArg.where.installmentId._value).toEqual([
        'installment-1',
        'installment-2',
      ]);
      expect(paymentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { paidAt: 'ASC' } }),
      );
    });

    it('returns an empty array without querying payments when the loan has no installments', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      installmentsRepository.find.mockResolvedValue([]);

      const result = await service.getPayments(mockLoan.id);

      expect(result).toEqual([]);
      expect(paymentsRepository.find).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getPayments('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(installmentsRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1' },
        { id: 'inst-2' },
      ]);
      paymentsRepository.count.mockResolvedValue(0);
    });

    it('soft-deletes the loan and its installments when it has no payments', async () => {
      await service.remove(mockLoan.id);

      expect(installmentsRepository.softDelete).toHaveBeenCalledWith({
        loanId: mockLoan.id,
      });
      expect(loansRepository.softDelete).toHaveBeenCalledWith({
        id: mockLoan.id,
      });
    });

    it('checks for payments across every installment of the loan', async () => {
      await service.remove(mockLoan.id);

      expect(paymentsRepository.count).toHaveBeenCalledWith({
        where: { installmentId: In(['inst-1', 'inst-2']) },
      });
    });

    it('skips the payment check entirely when the loan has no installments', async () => {
      installmentsRepository.find.mockResolvedValue([]);

      await service.remove(mockLoan.id);

      expect(paymentsRepository.count).not.toHaveBeenCalled();
      expect(loansRepository.softDelete).toHaveBeenCalledWith({
        id: mockLoan.id,
      });
    });

    it('rejects a loan that has at least one registered payment, unchanged', async () => {
      paymentsRepository.count.mockResolvedValue(1);

      await expect(service.remove(mockLoan.id)).rejects.toThrow(
        ConflictException,
      );
      expect(installmentsRepository.softDelete).not.toHaveBeenCalled();
      expect(loansRepository.softDelete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(paymentsRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('getPayoffQuote', () => {
    function pendingInstallment(
      overrides: Partial<Installment> = {},
    ): Installment {
      return {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: mockLoan,
        installmentNumber: 1,
        amount: 300000,
        principalPortion: 270000,
        dueDate: '2026-01-01',
        status: InstallmentStatus.Pending,
        isDownPayment: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
    });

    it('quotes only interest/principal for still-pending installments', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({ amount: 300000, principalPortion: 270000 }),
      ]);

      const quote = await service.getPayoffQuote(mockLoan.id);

      expect(installmentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            loanId: mockLoan.id,
            status: InstallmentStatus.Pending,
          },
        }),
      );
      expect(quote.totalPrincipalOwed).toBe(270000);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getPayoffQuote('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRefinanceQuote', () => {
    // bogotaTodayPlusDays is defined at module scope above — see its own
    // comment for why several tests below need it instead of a raw
    // `new Date(); setDate(...)`.
    function pendingInstallment(
      overrides: Partial<Installment> = {},
    ): Installment {
      return {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: mockLoan,
        installmentNumber: 1,
        amount: 300000,
        principalPortion: 270000,
        dueDate: '2026-01-01',
        status: InstallmentStatus.Pending,
        isDownPayment: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
    });

    it('suggests the payoff quote total as the new principal', async () => {
      // Far in the future — deterministic "not yet due", so the quote's
      // total is exactly principalPortion, regardless of when this test runs.
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);

      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          dueDate: futureDueDate.toISOString().slice(0, 10),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.suggestedPrincipalAmount).toBe(270000);
      expect(quote.suggestedPrincipalAmount).toBe(quote.payoff.totalDue);
    });

    it("carries over the first installment's concepts, dropping ones with a deleted catalog type", async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          id: 'concept-row-1',
          installmentId: 'inst-1',
          interestConceptTypeId: mockConceptType.id,
          nameSnapshot: mockConceptType.name,
          calculationType: ConceptCalculationType.Percentage,
          category: ConceptCategory.Corriente,
          value: 2,
          computedAmount: 6000,
        },
        {
          id: 'concept-row-2',
          installmentId: 'inst-1',
          interestConceptTypeId: null,
          nameSnapshot: 'Concepto eliminado',
          calculationType: ConceptCalculationType.FixedAmount,
          category: ConceptCategory.Corriente,
          value: 5000,
          computedAmount: 5000,
        },
      ]);

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.concepts).toEqual([
        {
          conceptTypeId: mockConceptType.id,
          calculationType: ConceptCalculationType.Percentage,
          value: 2,
        },
      ]);
    });

    it('returns an empty concepts array when the loan has no installments', async () => {
      installmentsRepository.find.mockResolvedValue([]);
      installmentsRepository.findOne.mockResolvedValue(null);

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.concepts).toEqual([]);
      expect(quote.suggestedPrincipalAmount).toBe(0);
    });

    // Phase 25 (confirmed with the human, reunión 2026-08-25): overdue and
    // near-due installments no longer block refinancing — instead, their
    // accrued interest is folded directly into suggestedPrincipalAmount.
    // These four tests replace the old blockedByPendingInstallments ones.
    it('does not add extra interest for an installment beyond the 5-day early-maturity window', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          dueDate: bogotaTodayPlusDays(21),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.suggestedPrincipalAmount).toBe(270000);
    });

    it('folds an installment due within 5 days into the new principal, corriente interest only (not yet actually overdue)', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          dueDate: bogotaTodayPlusDays(4),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );

      const quote = await service.getRefinanceQuote(mockLoan.id);

      // principalPortion (270000) + corriente interest already baked into
      // the cuota (300000 - 270000 = 30000) + 0 moratory, since no real
      // mora has accrued yet (overdueDays is still 0 four days out).
      expect(quote.suggestedPrincipalAmount).toBe(300000);
    });

    it('includes both corriente and moratory interest for an actually overdue installment (hand-calculated)', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          dueDate: bogotaTodayPlusDays(-3),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );

      const quote = await service.getRefinanceQuote(mockLoan.id);

      // Hand-calculated: principalPortion 270000 + corriente (300000 -
      // 270000 = 30000) + legacy moratory formula ((300000 * 6/100) / 30)
      // * 3 days = 1800 → 270000 + 30000 + 1800 = 301800.
      expect(quote.suggestedPrincipalAmount).toBe(301800);
    });

    it('folds an installment due in exactly 5 days into the new principal (inclusive boundary)', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          dueDate: bogotaTodayPlusDays(5),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.suggestedPrincipalAmount).toBe(300000);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getRefinanceQuote('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('payoff', () => {
    function pendingInstallment(
      overrides: Partial<Installment> = {},
    ): Installment {
      return {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: mockLoan,
        installmentNumber: 1,
        amount: 300000,
        principalPortion: 270000,
        dueDate: '2026-01-01',
        status: InstallmentStatus.Pending,
        isDownPayment: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      loansRepository.findOne.mockResolvedValue(null); // no refinancedTo
    });

    it('registers a payment per pending installment for the quoted total', async () => {
      // Far in the future — deterministic "not yet due", so the quoted
      // amount is exactly principalPortion with zero interest, regardless
      // of when this test actually runs.
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);

      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          id: 'inst-1',
          amount: 300000,
          principalPortion: 270000,
          dueDate: futureDueDate.toISOString().slice(0, 10),
        }),
      ]);

      await service.payoff(mockLoan.id);

      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentId: 'inst-1',
          amountPaid: 270000,
          observation: 'Liquidación anticipada',
        }),
      );
      expect(paymentsRepository.save).toHaveBeenCalled();
    });

    it('marks every pending installment paid and the loan paid', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);

      await service.payoff(mockLoan.id);

      expect(installmentsRepository.update).toHaveBeenCalledWith(
        { loanId: mockLoan.id, status: InstallmentStatus.Pending },
        { status: InstallmentStatus.Paid },
      );
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockLoan.id },
        { status: LoanStatus.Paid },
      );
    });

    it('rejects a loan that is already paid', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        status: LoanStatus.Paid,
      });

      await expect(service.payoff(mockLoan.id)).rejects.toThrow(
        BadRequestException,
      );
      expect(paymentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a loan that has already been refinanced', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        status: LoanStatus.Refinanced,
      });

      await expect(service.payoff(mockLoan.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.payoff('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
