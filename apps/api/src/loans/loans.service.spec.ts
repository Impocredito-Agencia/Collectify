import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
import { ClientsService } from '../clients/clients.service';
import {
  ConceptCalculationType,
  ConceptCategory,
  InterestConceptType,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { InterestConceptTypesService } from '../interestConceptTypes/interestConceptTypes.service';
import { UsuryRateService } from '../usuryRates/usuryRates.service';
import { WhatsappInboundMessage } from '../whatsapp/entities/whatsappInboundMessage.entity';

import { generateAmortizationSchedule } from './amortization/generateSchedule';
import { addDaysToDateString } from './dueDateSchedule';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { calculateMoraCharged } from './installments/installmentCalculations';
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
  let whatsappInboundMessagesRepository: { find: jest.Mock };
  let paymentImagesRepository: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
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
  let dataSource: { transaction: jest.Mock };
  let configService: { get: jest.Mock };

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
    disbursedAt: '2025-01-01',
    installmentFrequency: InstallmentFrequency.Monthly,
    totalInstallments: 3,
    status: LoanStatus.Active,
    refinancedFromLoanId: null,
    refinanceMoraWaivedAmount: 0,
    refinanceMoraWaiverReason: null,
    refinancedFromLoan: null,
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
  };

  beforeEach(async () => {
    loansRepository = {
      // Defaults to no loans — assertPromissoryNoteNumberIsUnique's Phase 35
      // reserved-number lookup reads it on every create()/renumber().
      find: jest.fn().mockResolvedValue([]),
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
    whatsappInboundMessagesRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    paymentImagesRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto: Record<string, unknown>) => dto),
      save: jest.fn((images: unknown[]) => Promise.resolve(images)),
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
    // Default: no cupo configured (creditAvailable: null means
    // unrestricted — see ClientsService.getCreditUsage) — so every
    // pre-existing test below, which doesn't care about Phase 10 at all,
    // keeps passing unaffected. Tests that DO care override this.
    // hasMoraBlock is no longer read by LoansService at all (2026-09-09,
    // see the 'creates the loan even when the client is mora-blocked'
    // test below) — kept mocked here only because ClientsService's own
    // shape still has the method.
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
                if (entity === Payment) return paymentsRepository;
                throw new Error(
                  `No mock repository registered for entity ${String(entity)}`,
                );
              },
            } as unknown as EntityManager;
            return work(manager);
          },
        ),
    };

    // Default: the installment-adjustment switch is off, as in production
    // — only adjustPendingInstallments' own tests turn it on.
    configService = {
      get: jest.fn().mockReturnValue({
        installmentAdjustmentEnabled: false,
        installmentAdjustmentPromissoryNotes: [],
      }),
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
          provide: getRepositoryToken(WhatsappInboundMessage),
          useValue: whatsappInboundMessagesRepository,
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
          provide: ClientCreditBalanceService,
          useValue: {
            summarizeCreditByPaymentId: jest.fn().mockResolvedValue(new Map()),
          },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
  });

  describe('create', () => {
    const createDto = {
      clientId: 'client-1',
      promissoryNoteNumber: '#900',
      principalAmount: 900000,
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
      // Corriente interest (defaults to a round 2% since 2026-09-30, see
      // DEFAULT_INTEREST_RATE_PERCENTAGE — well below the mocked 20% usury
      // ceiling) on the true declining balance (900000, 600000, 300000)
      // would be 18000/12000/6000 — but confirmed with the human
      // 2026-09-04 (matching the client's Excel): those get averaged into
      // one flat "cuota con interés" of 12000 every installment
      // ((18000+12000+6000)/3), rounded to the nearest $1,000 (already
      // exact here). So every installment totals 312000, not a declining
      // 318000/312000/306000.
      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentNumber: 1,
          amount: 312000,
          principalPortion: 300000,
          dueDate: '2026-02-01',
        }),
        expect.objectContaining({
          installmentNumber: 2,
          amount: 312000,
          principalPortion: 300000,
          dueDate: '2026-03-01',
        }),
        expect.objectContaining({
          installmentNumber: 3,
          amount: 312000,
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

    // Bug fix, 2026-09-09 — production bug: LoanForm asks the admin for
    // "fecha de la primera cuota" (not disbursedAt directly) and
    // back-computes disbursedAt by subtracting one month, which is lossy
    // whenever the source day is 29-31 and the previous month is shorter
    // (Feb here). Without firstInstallmentDueDate, disbursedAt arrives
    // already clamped to '2026-02-28', and since 28 <= every month's day
    // count, EVERY installment silently locked onto day 28 instead of
    // correctly landing on day 31 for 31-day months and the true last day
    // for shorter ones. Passing firstInstallmentDueDate lets the schedule
    // anchor on the admin's real input instead.
    it('anchors every due date on firstInstallmentDueDate, not the frontend-clamped disbursedAt', async () => {
      await service.create({
        ...createDto,
        // What LoanForm's computeDisbursedAt() actually sends when the
        // admin enters "31 de marzo de 2026" as the first cuota's date
        // (subtracting one month from March 31 clamps to Feb 28).
        disbursedAt: '2026-02-28',
        firstInstallmentDueDate: '2026-03-31',
        totalInstallments: 4,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentNumber: 1,
          dueDate: '2026-03-31',
        }),
        expect.objectContaining({
          installmentNumber: 2,
          dueDate: '2026-04-30',
        }),
        expect.objectContaining({
          installmentNumber: 3,
          dueDate: '2026-05-31',
        }),
        expect.objectContaining({
          installmentNumber: 4,
          dueDate: '2026-06-30',
        }),
      ]);
    });

    it('falls back to disbursedAt-based generation when firstInstallmentDueDate is omitted (e.g. Excel import)', async () => {
      await service.create(createDto);

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentNumber: 1,
          dueDate: '2026-02-01',
        }),
        expect.objectContaining({
          installmentNumber: 2,
          dueDate: '2026-03-01',
        }),
        expect.objectContaining({
          installmentNumber: 3,
          dueDate: '2026-04-01',
        }),
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

    // Phase 35 — see LoansService.findNumbersReservedByDeletedLoans.
    it('rejects a number held by a deleted loan that had payments', async () => {
      loansRepository.findOne.mockResolvedValue(null);
      loansRepository.find.mockResolvedValue([
        {
          id: 'deleted-paid',
          promissoryNoteNumber: createDto.promissoryNoteNumber,
        },
      ]);
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', loanId: 'deleted-paid' },
      ]);
      paymentsRepository.find.mockResolvedValue([{ installmentId: 'inst-1' }]);

      await expect(service.create(createDto)).rejects.toThrow(
        'perteneció a un pagaré eliminado',
      );
      expect(loansRepository.save).not.toHaveBeenCalled();
    });

    it('accepts a number held only by a deleted loan without payments', async () => {
      loansRepository.findOne.mockResolvedValue(null);
      loansRepository.find.mockResolvedValue([
        {
          id: 'deleted-unpaid',
          promissoryNoteNumber: createDto.promissoryNoteNumber,
        },
      ]);
      installmentsRepository.find.mockResolvedValueOnce([
        { id: 'inst-1', loanId: 'deleted-unpaid' },
      ]);
      paymentsRepository.find.mockResolvedValueOnce([]);

      await expect(service.create(createDto)).resolves.toBeDefined();
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

    // Restored, 2026-09-09 — the "new loan" WhatsApp message is no longer
    // sent synchronously from create(); it's picked up later by
    // NewLoanReminderService.runPendingLoanNotifications() on a schedule
    // (see whatsappCron.service.spec.ts / newLoanReminder.service.spec.ts
    // for that behavior). create() itself is only responsible for
    // persisting isNewLoan on the loan row.
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

    // Phase 10 — docs/phases/PHASE_10_CLIENT_CAPACITY.md's cupo guard.
    //
    // Changed, 2026-09-09 (client decision) — mora used to reject a new
    // loan here too, checked before cupo. Dropped: by the time a loan is
    // actually being created, the negotiation/paperwork already happened,
    // so a hard block at this exact step was the wrong place to catch it.
    // Mora is still surfaced (GET /clients/:id's isMoraBlocked, shown as a
    // warning on LoanForm.tsx) — it just no longer blocks creation. Cupo
    // is unaffected. See docs/DATABASE.md's note of this date.
    it('creates the loan even when the client is mora-blocked', async () => {
      clientsService.hasMoraBlock.mockResolvedValue(true);

      const result = await service.create(createDto);

      expect(result.id).toBe('loan-2');
      expect(loansRepository.save).toHaveBeenCalled();
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

    it('allows the loan when within cupo', async () => {
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

    it("checks cupo for the loan's clientId, and never checks mora-block at all", async () => {
      await service.create(createDto);

      expect(clientsService.getCreditUsage).toHaveBeenCalledWith('client-1');
      expect(clientsService.hasMoraBlock).not.toHaveBeenCalled();
    });

    // Human report, 2026-09-19 — see Loan.alternateContactPhoneNumber's
    // own comment.
    describe('alternate contact', () => {
      it('rejects when only alternateContactName is provided', async () => {
        await expect(
          service.create({
            ...createDto,
            alternateContactName: 'Hermana del deudor',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('rejects when only alternateContactPhoneNumber is provided', async () => {
        await expect(
          service.create({
            ...createDto,
            alternateContactPhoneNumber: '+573009876543',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('allows and persists both together', async () => {
        await service.create({
          ...createDto,
          alternateContactName: 'Hermana del deudor',
          alternateContactPhoneNumber: '+573009876543',
        });

        expect(loansRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            alternateContactName: 'Hermana del deudor',
            alternateContactPhoneNumber: '+573009876543',
          }),
        );
      });

      it('allows omitting both', async () => {
        await service.create(createDto);

        expect(loansRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            alternateContactName: null,
            alternateContactPhoneNumber: null,
          }),
        );
      });
    });

    // Redesign, 2026-09-03 — corrienteInterestRate/moratoryInterestRate are
    // always capped at the current usury ceiling (20% in the default
    // beforeEach mock). "Editable solo hacia abajo [del techo]" — confirmed
    // with the human. Human request, 2026-09-30 — when omitted, they no
    // longer default to that ceiling itself; see the next two tests.
    describe('system-generated interest field', () => {
      it('defaults corrienteInterestRate/moratoryInterestRate to a round 2% when omitted, well below the usury ceiling', async () => {
        await service.create(createDto);

        const calls = loanInstallmentConceptsRepository.save.mock
          .calls as unknown[][];
        const savedRows = calls[0][0] as Array<{ value: number }>;
        expect(savedRows.every((row) => row.value === 2)).toBe(true);
      });

      // Human request, 2026-09-30 — the round 2% default is purely a
      // convenience; it must never be allowed to outrank the certified
      // rate on a month where that rate itself lands below 2% (cobrar por
      // encima de la tasa de usura es delito, Art. 305 Código Penal).
      it('falls back to the usury ceiling instead of 2% on a month whose certified rate is lower', async () => {
        usuryRateService.getCurrentRate.mockResolvedValue({
          id: 'rate-low',
          effectiveMonth: '2026-07-01',
          ratePercentage: 1.5,
          createdBy: null,
          createdByUser: null,
          createdAt: new Date(),
          isStale: false,
        });

        await service.create(createDto);

        const calls = loanInstallmentConceptsRepository.save.mock
          .calls as unknown[][];
        const savedRows = calls[0][0] as Array<{ value: number }>;
        expect(savedRows.every((row) => row.value === 1.5)).toBe(true);
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
      // declining corriente interest (600000 then 300000 balance * 2% —
      // the round default since 2026-09-30, well below the mocked 20%
      // ceiling) is 12000/6000 — averaged into a flat 9000/installment
      // ((12000+6000)/2), so both installments total 309000, not a
      // declining 312000/306000.
      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ installmentNumber: 1, amount: 309000 }),
        expect.objectContaining({ installmentNumber: 2, amount: 309000 }),
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

    // Human report, 2026-09-19 — same carry-over-unless-overridden rule
    // as the co-debtor above, for the alternate contact.
    it("carries over the old loan's alternate contact when the refinance dto omits it", async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy
        .mockResolvedValueOnce({
          ...mockLoan,
          alternateContactName: 'Hermana del deudor',
          alternateContactPhoneNumber: '+573009876543',
        })
        .mockResolvedValueOnce(newLoanRecord);

      await service.refinance(mockLoan.id, refinanceDto);

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alternateContactName: 'Hermana del deudor',
          alternateContactPhoneNumber: '+573009876543',
        }),
      );
    });

    it('clears the alternate contact when the refinance dto explicitly sends null', async () => {
      loansRepository.findOneBy.mockReset();
      loansRepository.findOneBy
        .mockResolvedValueOnce({
          ...mockLoan,
          alternateContactName: 'Hermana del deudor',
          alternateContactPhoneNumber: '+573009876543',
        })
        .mockResolvedValueOnce(newLoanRecord);

      await service.refinance(mockLoan.id, {
        ...refinanceDto,
        alternateContactName: null,
        alternateContactPhoneNumber: null,
      });

      expect(loansRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alternateContactName: null,
          alternateContactPhoneNumber: null,
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

    // Human request, 2026-11-05 — part of the old loan's accrued mora may be
    // forgiven in the refinance, up to the quote's maxMoraWaivable.
    describe('mora waiver', () => {
      function mockQuoteMax(maxMoraWaivable: number): jest.SpyInstance {
        return jest
          .spyOn(service, 'getRefinanceQuote')
          .mockResolvedValue({ maxMoraWaivable } as never);
      }

      it('records the waiver and its trimmed reason on the new loan', async () => {
        const quoteSpy = mockQuoteMax(30000);

        await service.refinance(mockLoan.id, {
          ...refinanceDto,
          moraWaivedAmount: 30000,
          moraWaiverReason: '  Descuento por pronto pago  ',
        });

        expect(quoteSpy).toHaveBeenCalledWith(mockLoan.id);
        expect(loansRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            refinanceMoraWaivedAmount: 30000,
            refinanceMoraWaiverReason: 'Descuento por pronto pago',
          }),
        );
      });

      it('rejects a waiver bigger than the mora the quote is charging, before touching anything', async () => {
        mockQuoteMax(30000);

        await expect(
          service.refinance(mockLoan.id, {
            ...refinanceDto,
            moraWaivedAmount: 30001,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('rejects any waiver when the loan has no mora', async () => {
        mockQuoteMax(0);

        await expect(
          service.refinance(mockLoan.id, {
            ...refinanceDto,
            moraWaivedAmount: 1,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(loansRepository.save).not.toHaveBeenCalled();
      });

      it('records no waiver (and skips the quote) when none is requested', async () => {
        const quoteSpy = mockQuoteMax(30000);

        await service.refinance(mockLoan.id, {
          ...refinanceDto,
          moraWaiverReason: 'ignored without an amount',
        });

        expect(quoteSpy).not.toHaveBeenCalled();
        expect(loansRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            refinanceMoraWaivedAmount: 0,
            refinanceMoraWaiverReason: null,
          }),
        );
      });
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
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: overdueInstallment.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
        },
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
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        // FixedAmount (bug fix, 2026-09-15), not Percentage — a percentage
        // rate compounds with real elapsed days since dueDate, which
        // change every time this suite runs (calculatePayoff() here has
        // no fixed `today` to pin it against, unlike calculatePayoff.spec.ts's
        // own fixtures), making the resulting rounding delta this test
        // would need to predict non-deterministic. FixedAmount charges the
        // same flat 5000 regardless of overdueDays, keeping the whole
        // installment (210000 + 5000 = 215000) landing exactly on a round
        // hundred with zero rounding delta to account for.
        {
          installmentId: overduePending.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.FixedAmount,
          nameSnapshot: 'Intereses moratorios',
          value: 5000,
        },
      ]);

      const result = await service.findOne(mockLoan.id);

      // Sanity check: this installment does accrue interest, so a naive
      // "sum of totalDue" would overstate the pure-principal figure.
      expect(result.installments[0].interest).toBeGreaterThan(0);
      expect(result.currentPrincipalBalance).toBe(200000);
    });

    // Bug fix, 2026-09-15 (human report) — currentPrincipalBalance reuses
    // calculatePayoff() (see this test file's own header comment above),
    // so a prior partial payment on a pending installment used to inflate
    // "saldo capital a la fecha" the same way it inflated a payoff quote.
    it('nets an existing partial payment off currentPrincipalBalance too', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      const pending: Installment = {
        id: 'inst-1',
        loanId: mockLoan.id,
        loan: undefined as never,
        installmentNumber: 1,
        amount: 210000,
        principalPortion: 200000,
        dueDate: '2024-01-01',
        status: InstallmentStatus.Pending,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      installmentsRepository.find.mockResolvedValue([pending]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 50000 },
      ]);

      const result = await service.findOne(mockLoan.id);

      // Gross interest here is just the corriente portion baked into the
      // installment (amount 210000 - principalPortion 200000 = 10000; no
      // moratory concepts mocked). totalPaid 50000 clears that 10000
      // first, the remaining 40000 comes off principal: 200000 - 40000.
      expect(result.currentPrincipalBalance).toBe(160000);
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

    describe('sorting the whole list (not just the loaded page)', () => {
      const loanFor = (
        id: string,
        firstName: string,
        promissoryNoteNumber: string,
      ): Loan => ({
        ...mockLoan,
        id,
        promissoryNoteNumber,
        client: { firstName, lastName: 'Prueba' } as never,
      });

      it('sorts by client name descending before paginating', async () => {
        loansRepository.find.mockResolvedValue([
          loanFor('l1', 'Ana', '#1'),
          loanFor('l2', 'Mario', '#2'),
          loanFor('l3', 'Zoe', '#3'),
        ]);

        const page1 = await service.findAll({
          sortBy: 'clientFullName',
          sortDirection: 'desc',
          limit: 2,
        });
        const page2 = await service.findAll({
          sortBy: 'clientFullName',
          sortDirection: 'desc',
          limit: 2,
          page: 2,
        });

        expect(page1.items.map((l) => l.id)).toEqual(['l3', 'l2']);
        expect(page2.items.map((l) => l.id)).toEqual(['l1']);
        expect(page1.meta.total).toBe(3);
      });

      it('sorts by pagaré number descending, numerically', async () => {
        loansRepository.find.mockResolvedValue([
          loanFor('l1', 'Ana', '#2'),
          loanFor('l2', 'Ana', '#101'),
          loanFor('l3', 'Ana', '#30'),
        ]);

        const result = await service.findAll({
          sortBy: 'promissoryNoteNumber',
          sortDirection: 'desc',
        });

        expect(result.items.map((l) => l.promissoryNoteNumber)).toEqual([
          '#101',
          '#30',
          '#2',
        ]);
      });

      it('orders the entire list by a computed column (overdueDays), not just one page', async () => {
        // l1 is first by pagaré number but current; l3 (last by number) is the
        // one overdue. Sorted per-page it could never reach page 1.
        loansRepository.find.mockResolvedValue([
          loanFor('l1', 'Ana', '#1'),
          loanFor('l2', 'Mario', '#2'),
          loanFor('l3', 'Zoe', '#3'),
        ]);
        installmentsRepository.find.mockResolvedValue([
          {
            id: 'i3',
            loanId: 'l3',
            installmentNumber: 1,
            amount: 100000,
            principalPortion: 100000,
            dueDate: '2020-01-01',
            status: InstallmentStatus.Pending,
            isDownPayment: false,
          },
        ]);

        const result = await service.findAll({
          sortBy: 'overdueDays',
          sortDirection: 'desc',
          limit: 1,
        });

        expect(result.items.map((l) => l.id)).toEqual(['l3']);
        expect(result.items[0].overdueDays).toBeGreaterThan(0);
        expect(result.meta.total).toBe(3);
      });

      it('sorts by the status label shown in the list ("Al día" before "En mora")', async () => {
        loansRepository.find.mockResolvedValue([
          loanFor('l1', 'Ana', '#1'),
          loanFor('l2', 'Mario', '#2'),
        ]);
        installmentsRepository.find.mockResolvedValue([
          {
            id: 'i1',
            loanId: 'l1',
            installmentNumber: 1,
            amount: 100000,
            principalPortion: 100000,
            dueDate: '2020-01-01',
            status: InstallmentStatus.Pending,
            isDownPayment: false,
          },
        ]);

        const result = await service.findAll({ sortBy: 'status' });

        // l1 is overdue ("En mora"), l2 is current ("Al día") — "Al día"
        // sorts first alphabetically.
        expect(result.items.map((l) => l.id)).toEqual(['l2', 'l1']);
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
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'installment-1',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
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
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'installment-1',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
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

    // Phase 35 — a deleted test pagaré (#9999) must not drag the
    // suggestion up forever.
    it('ignores deleted loans when finding the highest number', async () => {
      loansRepository.find.mockResolvedValue([
        { ...mockLoan, id: 'live', promissoryNoteNumber: '#1190' },
        {
          ...mockLoan,
          id: 'deleted',
          promissoryNoteNumber: '#9999',
          deletedAt: new Date(),
        },
      ]);
      installmentsRepository.find.mockResolvedValue([]);

      const result = await service.getNextPromissoryNoteNumber();

      expect(result).toEqual({ nextPromissoryNoteNumber: '#1191' });
    });

    it('skips a number still reserved by a deleted loan that had payments', async () => {
      loansRepository.find.mockResolvedValue([
        { ...mockLoan, id: 'live', promissoryNoteNumber: '#1190' },
        {
          ...mockLoan,
          id: 'deleted-paid',
          promissoryNoteNumber: '#1191',
          deletedAt: new Date(),
        },
      ]);
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', loanId: 'deleted-paid' },
      ]);
      paymentsRepository.find.mockResolvedValue([{ installmentId: 'inst-1' }]);

      const result = await service.getNextPromissoryNoteNumber();

      expect(result).toEqual({ nextPromissoryNoteNumber: '#1192' });
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

    // Bug fix, 2026-09-09 — see the identical regression test in the
    // `create` block above for the full production scenario.
    it('anchors every previewed due date on firstInstallmentDueDate when given', async () => {
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
        disbursedAt: '2026-02-28',
        firstInstallmentDueDate: '2026-03-31',
        installmentFrequency: InstallmentFrequency.Monthly,
        totalInstallments: 3,
        concepts: [],
        moratoryConcepts: [],
      });

      expect(result.installments.map((i) => i.dueDate)).toEqual([
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ]);
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

    // Human report, 2026-09-19 — validated against the RESULTING merged
    // state, not just this one PATCH's own two fields — see
    // LoansService.update's own comment.
    describe('alternate contact', () => {
      it('rejects setting only the phone number when no name is on file', async () => {
        loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });

        await expect(
          service.update(mockLoan.id, {
            alternateContactPhoneNumber: '+573009876543',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts setting only the phone number when a name is already on file', async () => {
        loansRepository.findOneBy.mockResolvedValue({
          ...mockLoan,
          alternateContactName: 'Hermana del deudor',
        });
        loansRepository.save.mockImplementation((loan: Loan) =>
          Promise.resolve(loan),
        );

        const result = await service.update(mockLoan.id, {
          alternateContactPhoneNumber: '+573009876543',
        });

        expect(result.alternateContactPhoneNumber).toBe('+573009876543');
      });
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

  // Phase 35 — the payment history of a deleted pagaré's read-only view.
  describe('getDeletedLoanPayments', () => {
    it("reads a deleted loan's soft-deleted installments and their voided payments", async () => {
      loansRepository.findOne.mockResolvedValue({
        ...mockLoan,
        deletedAt: new Date(),
      });
      installmentsRepository.find.mockResolvedValue([{ id: 'installment-1' }]);
      paymentsRepository.find.mockResolvedValue([
        {
          id: 'payment-1',
          installmentId: 'installment-1',
          amountPaid: 200,
          voidReason: 'Pagaré eliminado: Pagaré de prueba',
        },
      ]);

      const result = await service.getDeletedLoanPayments(mockLoan.id);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'payment-1',
          voidReason: 'Pagaré eliminado: Pagaré de prueba',
        }),
      ]);
      expect(installmentsRepository.find).toHaveBeenCalledWith({
        where: { loanId: mockLoan.id },
        select: ['id'],
        withDeleted: true,
      });
    });

    it('throws NotFoundException for a loan that is not deleted', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await expect(service.getDeletedLoanPayments(mockLoan.id)).rejects.toThrow(
        NotFoundException,
      );
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
      expect(result).toEqual([
        {
          ...payments[0],
          imageUrls: [],
          creditGeneratedAmount: 0,
          creditSpentAmount: 0,
          sourceWhatsappMessage: null,
        },
      ]);
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

    it('links a payment back to the WhatsApp message it was registered from, earliest message winning', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      installmentsRepository.find.mockResolvedValue([{ id: 'installment-1' }]);
      paymentsRepository.find.mockResolvedValue([
        { id: 'payment-1', installmentId: 'installment-1', amountPaid: 200 },
        { id: 'payment-2', installmentId: 'installment-1', amountPaid: 300 },
      ]);
      const firstReceivedAt = new Date('2026-09-20T10:00:00Z');
      whatsappInboundMessagesRepository.find.mockResolvedValue([
        {
          id: 'message-1',
          paymentId: 'payment-1',
          clientId: 'client-1',
          receivedAt: firstReceivedAt,
        },
        {
          id: 'message-2',
          paymentId: 'payment-1',
          clientId: 'client-1',
          receivedAt: new Date('2026-09-21T10:00:00Z'),
        },
      ]);

      const result = await service.getPayments(mockLoan.id);

      expect(result[0].sourceWhatsappMessage).toEqual({
        id: 'message-1',
        clientId: 'client-1',
        receivedAt: firstReceivedAt,
      });
      expect(result[1].sourceWhatsappMessage).toBeNull();
      const [[callArg]] = whatsappInboundMessagesRepository.find.mock.calls as [
        [{ where: { paymentId: { _value: string[] } } }],
      ];
      expect(callArg.where.paymentId._value).toEqual([
        'payment-1',
        'payment-2',
      ]);
    });

    it('returns an empty array without querying payments when the loan has no installments', async () => {
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      installmentsRepository.find.mockResolvedValue([]);

      const result = await service.getPayments(mockLoan.id);

      expect(result).toEqual([]);
      expect(paymentsRepository.find).not.toHaveBeenCalled();
      expect(whatsappInboundMessagesRepository.find).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getPayments('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(installmentsRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('adjustPendingInstallments', () => {
    const pendingInstallment = (
      overrides: Partial<Installment> = {},
    ): Installment => ({
      id: 'inst-1',
      loanId: mockLoan.id,
      loan: undefined as never,
      installmentNumber: 1,
      isDownPayment: false,
      amount: 310000,
      principalPortion: 300000,
      dueDate: '2099-01-01',
      status: InstallmentStatus.Pending,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    });

    beforeEach(() => {
      configService.get.mockReturnValue({
        installmentAdjustmentEnabled: true,
        installmentAdjustmentPromissoryNotes: ['743'],
      });
      loansRepository.findOneBy.mockResolvedValue(mockLoan);
      loansRepository.findOne.mockResolvedValue(null);
      loansRepository.update.mockResolvedValue({ affected: 1 });
      installmentsRepository.save.mockImplementation((rows: unknown) =>
        Promise.resolve(rows),
      );
    });

    it('adds the amount to every pending installment, as capital, and grows the loan principal to match', async () => {
      const first = pendingInstallment();
      const second = pendingInstallment({
        id: 'inst-2',
        installmentNumber: 2,
        dueDate: '2099-02-01',
      });
      installmentsRepository.find.mockResolvedValue([first, second]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: 10000,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'inst-1',
          amount: 320000,
          principalPortion: 310000,
        }),
        expect.objectContaining({
          id: 'inst-2',
          amount: 320000,
          principalPortion: 310000,
        }),
      ]);
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockLoan.id },
        { principalAmount: mockLoan.principalAmount + 20000 },
      );
    });

    it('only loads pending installments — paid and cancelled ones are never touched', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: 10000,
      });

      expect(installmentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { loanId: mockLoan.id, status: InstallmentStatus.Pending },
        }),
      );
    });

    it('leaves a legacy installment with no capital split as null, adjusting only its amount', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({ principalPortion: null }),
      ]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: 10000,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ amount: 320000, principalPortion: null }),
      ]);
    });

    it('never touches the installment concepts (interest stays as generated)', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: 10000,
      });

      expect(loanInstallmentConceptsRepository.save).not.toHaveBeenCalled();
      expect(loanInstallmentConceptsRepository.update).not.toHaveBeenCalled();
    });

    it('accepts a negative amount to lower the installments', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: -10000,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ amount: 300000, principalPortion: 290000 }),
      ]);
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockLoan.id },
        { principalAmount: mockLoan.principalAmount - 10000 },
      );
    });

    it('closes a lowered installment as paid when what was already paid covers its corrected amount', async () => {
      const first = pendingInstallment();
      const second = pendingInstallment({
        id: 'inst-2',
        installmentNumber: 2,
        dueDate: '2099-02-01',
      });
      installmentsRepository.find.mockResolvedValue([first, second]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000, moraWaivedAmount: 0 },
      ]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: -10000,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'inst-1',
          amount: 300000,
          principalPortion: 290000,
          status: InstallmentStatus.Paid,
        }),
        expect.objectContaining({
          id: 'inst-2',
          amount: 300000,
          status: InstallmentStatus.Pending,
        }),
      ]);
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockLoan.id },
        { principalAmount: mockLoan.principalAmount - 20000 },
      );
    });

    it('counts mora waived with a payment toward covering the corrected amount', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment(),
        pendingInstallment({ id: 'inst-2', installmentNumber: 2 }),
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 295000, moraWaivedAmount: 5000 },
      ]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: -10000,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'inst-1',
          status: InstallmentStatus.Paid,
        }),
        expect.objectContaining({
          id: 'inst-2',
          status: InstallmentStatus.Pending,
        }),
      ]);
    });

    it('marks the loan paid when the adjustment settles every pending installment', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000, moraWaivedAmount: 0 },
      ]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: -10000,
      });

      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: mockLoan.id },
        {
          principalAmount: mockLoan.principalAmount - 10000,
          status: LoanStatus.Paid,
        },
      );
    });

    it('keeps a partially paid installment pending when its payments do not cover the corrected amount', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 100000, moraWaivedAmount: 0 },
      ]);

      await service.adjustPendingInstallments(mockLoan.id, {
        amountPerInstallment: -10000,
      });

      expect(installmentsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          amount: 300000,
          status: InstallmentStatus.Pending,
        }),
      ]);
    });

    it('rejects lowering an installment below the cash already paid on it', async () => {
      installmentsRepository.find.mockResolvedValue([pendingInstallment()]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 305000, moraWaivedAmount: 0 },
      ]);

      await expect(
        service.adjustPendingInstallments(mockLoan.id, {
          amountPerInstallment: -10000,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(installmentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects lowering an installment below zero capital', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({ amount: 310000, principalPortion: 5000 }),
      ]);

      await expect(
        service.adjustPendingInstallments(mockLoan.id, {
          amountPerInstallment: -10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a loan with no pending installments', async () => {
      installmentsRepository.find.mockResolvedValue([]);

      await expect(
        service.adjustPendingInstallments(mockLoan.id, {
          amountPerInstallment: 10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses while the switch is off, even for a listed pagaré', async () => {
      configService.get.mockReturnValue({
        installmentAdjustmentEnabled: false,
        installmentAdjustmentPromissoryNotes: ['743'],
      });

      await expect(
        service.adjustPendingInstallments(mockLoan.id, {
          amountPerInstallment: 10000,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses a pagaré that is not listed', async () => {
      configService.get.mockReturnValue({
        installmentAdjustmentEnabled: true,
        installmentAdjustmentPromissoryNotes: ['1113'],
      });

      await expect(
        service.adjustPendingInstallments(mockLoan.id, {
          amountPerInstallment: 10000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a loan that is no longer active', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        status: LoanStatus.Refinanced,
      });

      await expect(
        service.adjustPendingInstallments(mockLoan.id, {
          amountPerInstallment: 10000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.adjustPendingInstallments('missing-loan', {
          amountPerInstallment: 10000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports the loan as adjustable in findOne only while it is unlocked', async () => {
      installmentsRepository.find.mockResolvedValue([]);

      const unlocked = await service.findOne(mockLoan.id);
      configService.get.mockReturnValue({
        installmentAdjustmentEnabled: false,
        installmentAdjustmentPromissoryNotes: ['743'],
      });
      const locked = await service.findOne(mockLoan.id);

      expect(unlocked.canAdjustPendingInstallments).toBe(true);
      expect(locked.canAdjustPendingInstallments).toBe(false);
    });
  });

  // Human request, 2026-10-21 — see LoansService.renumber.
  describe('renumber', () => {
    beforeEach(() => {
      installmentsRepository.find.mockResolvedValue([]);
    });

    function mockLoans(...loans: Loan[]) {
      loansRepository.findOneBy.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(loans.find((loan) => loan.id === id) ?? null),
      );
    }

    it('renames an active loan with no refinancing history', async () => {
      mockLoans({ ...mockLoan });
      loansRepository.findOne.mockResolvedValue(null);

      await service.renumber(mockLoan.id, { promissoryNoteNumber: '#1201' });

      expect(loansRepository.findOne).toHaveBeenCalledWith({
        where: { promissoryNoteNumber: '#1201' },
      });
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: In([mockLoan.id]) },
        { promissoryNoteNumber: '#1201' },
      );
    });

    it('renames every earlier loan of the chain that shares the number, and stops at one that does not', async () => {
      const oldest = {
        ...mockLoan,
        id: 'loan-a',
        promissoryNoteNumber: '#0500',
        status: LoanStatus.Refinanced,
      };
      const middle = {
        ...mockLoan,
        id: 'loan-b',
        refinancedFromLoanId: 'loan-a',
        status: LoanStatus.Refinanced,
      };
      const current = {
        ...mockLoan,
        id: 'loan-c',
        refinancedFromLoanId: 'loan-b',
      };
      mockLoans(oldest, middle, current);
      loansRepository.findOne.mockResolvedValue(null);

      await service.renumber('loan-c', { promissoryNoteNumber: '#1201' });

      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: In(['loan-c', 'loan-b']) },
        { promissoryNoteNumber: '#1201' },
      );
    });

    it('rejects a number already used by another loan', async () => {
      mockLoans({ ...mockLoan });
      loansRepository.findOne.mockResolvedValue({
        ...mockLoan,
        id: 'other-loan',
        promissoryNoteNumber: '#1201',
        status: LoanStatus.Paid,
      });

      await expect(
        service.renumber(mockLoan.id, { promissoryNoteNumber: '#1201' }),
      ).rejects.toThrow(ConflictException);
      expect(loansRepository.update).not.toHaveBeenCalled();
    });

    it.each([LoanStatus.Paid, LoanStatus.Refinanced])(
      'rejects a %s loan',
      async (status) => {
        mockLoans({ ...mockLoan, status });

        await expect(
          service.renumber(mockLoan.id, { promissoryNoteNumber: '#1201' }),
        ).rejects.toThrow(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('changes nothing when the number is the same', async () => {
      mockLoans({ ...mockLoan });
      loansRepository.findOne.mockResolvedValue(null);

      await service.renumber(mockLoan.id, {
        promissoryNoteNumber: mockLoan.promissoryNoteNumber,
      });

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(loansRepository.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      mockLoans();

      await expect(
        service.renumber('missing', { promissoryNoteNumber: '#1201' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // Interest true-up, 2026-09-23 (agreed with the human) — the worked
  // example: 2.600.000 / 12 cuotas / 3,9% per period, flat cuota $271.600.
  // 10 cuotas paid (all past due), cuotas 11 and 12 still pending and not
  // yet due. Capital-only would be 433.333,30; the smoothed cuotas
  // under-collected 84.417 of the interest already caused.
  describe('interest true-up on payoff and refinance', () => {
    const schedule = generateAmortizationSchedule(2600000, 12, [
      {
        conceptTypeId: null,
        name: 'Intereses corrientes',
        calculationType: ConceptCalculationType.Percentage,
        value: 3.9,
      },
    ]);

    // Cuotas 1-10 are due today or earlier (10 is due today), cuota 11 in
    // 30 days and cuota 12 in 60.
    function dueDateOf(installmentNumber: number): string {
      return bogotaTodayPlusDays((installmentNumber - 11) * 30 + 30);
    }

    const allInstallments: Installment[] = schedule.map((generated) => ({
      id: `inst-${generated.installmentNumber}`,
      loanId: mockLoan.id,
      loan: mockLoan,
      installmentNumber: generated.installmentNumber,
      amount: generated.amount,
      principalPortion: generated.principalPortion,
      dueDate: dueDateOf(generated.installmentNumber),
      status:
        generated.installmentNumber <= 10
          ? InstallmentStatus.Paid
          : InstallmentStatus.Pending,
      isDownPayment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }));

    const conceptRows = schedule.flatMap((generated) =>
      generated.concepts.map(
        (concept) =>
          ({
            id: `concept-${generated.installmentNumber}`,
            installmentId: `inst-${generated.installmentNumber}`,
            interestConceptTypeId: null,
            nameSnapshot: concept.name,
            calculationType: ConceptCalculationType.Percentage,
            category: ConceptCategory.Corriente,
            value: concept.value,
            computedAmount: concept.computedAmount,
          }) as LoanInstallmentConcept,
      ),
    );

    beforeEach(() => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      loansRepository.findOne.mockResolvedValue(null);
      installmentsRepository.find.mockImplementation(
        (options: { where: { status?: InstallmentStatus } }) =>
          Promise.resolve(
            options.where.status === InstallmentStatus.Pending
              ? allInstallments.filter(
                  (installment) =>
                    installment.status === InstallmentStatus.Pending,
                )
              : allInstallments,
          ),
      );
      installmentsRepository.findOne.mockResolvedValue(allInstallments[0]);
      loanInstallmentConceptsRepository.find.mockResolvedValue(conceptRows);
    });

    it('quotes capital plus the true-up for a payoff (433.333,30 + 84.417)', async () => {
      const quote = await service.getPayoffQuote(mockLoan.id);

      expect(quote.totalPrincipalOwed).toBeCloseTo(433333.3, 2);
      expect(quote.interestTrueUp).toBe(84417);
      expect(quote.totalDue).toBeCloseTo(433333.3 + 84417, 2);
    });

    it("keeps the true-up label ahead of the admin's detail", async () => {
      await service.payoff(mockLoan.id, { observation: 'Pagó en efectivo' });

      const created = paymentsRepository.create.mock.calls.map(
        ([payment]: [{ observation: string }]) => payment,
      );
      expect(created[0].observation).toBe(
        'Liquidación anticipada (incluye ajuste de interés causado) — Pagó en efectivo',
      );
      expect(created[1].observation).toBe(
        'Liquidación anticipada — Pagó en efectivo',
      );
    });

    it('registers payments that sum to the quoted total, true-up on the first pending cuota', async () => {
      await service.payoff(mockLoan.id);

      const created = paymentsRepository.create.mock.calls.map(
        ([payment]: [{ installmentId: string; amountPaid: number }]) => payment,
      );
      const total = created.reduce(
        (sum, payment) => sum + payment.amountPaid,
        0,
      );

      expect(total).toBeCloseTo(433333.3 + 84417, 2);
      expect(created[0]).toEqual(
        expect.objectContaining({
          installmentId: 'inst-11',
          observation:
            'Liquidación anticipada (incluye ajuste de interés causado)',
        }),
      );
      expect(created[0].amountPaid).toBeCloseTo(216666.67 + 84417, 2);
      expect(created[1].amountPaid).toBeCloseTo(216666.63, 2);
    });

    it('folds the true-up into the refinance suggested principal too', async () => {
      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.payoff.interestTrueUp).toBeGreaterThanOrEqual(84417);
      expect(quote.suggestedPrincipalAmount).toBe(quote.payoff.totalDue);
    });

    it('separates the interest that only entered through the grace period', async () => {
      // Cuota 11's period starts when cuota 10 becomes due (see
      // buildPeriodStartDates). Shifting cuota 10 back 5 days means cuota
      // 11's own period has now run for exactly the grace period — even
      // though cuota 11 itself is still 30 days from its own due date — so
      // its true interest (16.900) counts as an "early" inclusion.
      const shifted = allInstallments.map((installment) =>
        installment.installmentNumber === 10
          ? { ...installment, dueDate: bogotaTodayPlusDays(-5) }
          : installment,
      );
      installmentsRepository.find.mockResolvedValue(shifted);

      const quote = await service.getRefinanceQuote(mockLoan.id);

      // Within a peso or two: the true-up is rounded to whole pesos.
      expect(quote.earlyWindowInstallmentNumbers).toEqual([11]);
      expect(quote.earlyWindowInterest).toBeCloseTo(16900, -1);
      // Formal interest = everything else: the 10 matured cuotas' 84.417.
      expect(
        quote.payoff.totalInterestOwed - quote.earlyWindowInterest,
      ).toBeCloseTo(84417, -1);
    });

    it('reports no window interest when no installment is inside the window', async () => {
      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.earlyWindowInterest).toBe(0);
      expect(quote.earlyWindowInstallmentNumbers).toEqual([]);
    });

    it('adds no true-up once nothing is pending (already paid/refinanced loan)', async () => {
      installmentsRepository.find.mockImplementation(
        (options: { where: { status?: InstallmentStatus } }) =>
          Promise.resolve(
            options.where.status === InstallmentStatus.Pending
              ? []
              : allInstallments.map((installment) => ({
                  ...installment,
                  status: InstallmentStatus.Paid,
                })),
          ),
      );

      const quote = await service.getPayoffQuote(mockLoan.id);

      expect(quote.interestTrueUp).toBe(0);
      expect(quote.totalDue).toBe(0);
    });
  });

  // Préstamo #0911-like case (2026-09-23): 1.000.000 / 10 cuotas / 4,5%,
  // nothing paid, cuota 1 overdue. Its real interest (45.000) must sit
  // inside its own row, so the table rows add up to the total.
  describe('interest true-up attributed to a pending overdue cuota', () => {
    const schedule = generateAmortizationSchedule(1000000, 10, [
      {
        conceptTypeId: null,
        name: 'Intereses corrientes',
        calculationType: ConceptCalculationType.Percentage,
        value: 4.5,
      },
    ]);
    const installments: Installment[] = schedule.map((generated) => ({
      id: `inst-${generated.installmentNumber}`,
      loanId: mockLoan.id,
      loan: mockLoan,
      installmentNumber: generated.installmentNumber,
      amount: generated.amount,
      principalPortion: generated.principalPortion,
      dueDate: bogotaTodayPlusDays(
        generated.installmentNumber === 1
          ? -11
          : generated.installmentNumber * 30,
      ),
      status: InstallmentStatus.Pending,
      isDownPayment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }));
    const conceptRows = schedule.flatMap((generated) =>
      generated.concepts.map(
        (concept) =>
          ({
            id: `concept-${generated.installmentNumber}`,
            installmentId: `inst-${generated.installmentNumber}`,
            interestConceptTypeId: null,
            nameSnapshot: concept.name,
            calculationType: ConceptCalculationType.Percentage,
            category: ConceptCategory.Corriente,
            value: concept.value,
            computedAmount: concept.computedAmount,
          }) as LoanInstallmentConcept,
      ),
    );

    beforeEach(() => {
      loansRepository.findOneBy.mockResolvedValue({ ...mockLoan });
      installmentsRepository.find.mockResolvedValue(installments);
      loanInstallmentConceptsRepository.find.mockResolvedValue(conceptRows);
    });

    it('shows the real interest on the overdue row and leaves nothing unattributed', async () => {
      const quote = await service.getPayoffQuote(mockLoan.id);

      expect(quote.installments[0].interestApplied).toBeCloseTo(45000, 0);
      expect(quote.interestTrueUp).toBe(0);
      const rowsTotal = quote.installments.reduce(
        (sum, item) => sum + item.totalDue,
        0,
      );
      expect(rowsTotal).toBeCloseTo(quote.totalDue, 2);
    });
  });

  // Client request, 2026-10-26 — ClientDetailPage's "what they owe today"
  // figures, aggregated across every loan still in course.
  describe('getClientDebtSummary', () => {
    function quote(totalPrincipalOwed: number, totalDue: number) {
      return {
        installments: [],
        interestTrueUp: 0,
        totalInterestOwed: totalDue - totalPrincipalOwed,
        totalPrincipalOwed,
        totalDue,
      };
    }

    it("sums every active loan's payoff quote", async () => {
      loansRepository.find.mockResolvedValue([
        { id: 'loan-a' },
        { id: 'loan-b' },
      ]);
      const getPayoffQuote = jest
        .spyOn(service, 'getPayoffQuote')
        .mockImplementation((id) =>
          Promise.resolve(
            id === 'loan-a' ? quote(1000000, 1250000) : quote(400000, 400000),
          ),
        );

      const summary = await service.getClientDebtSummary('client-1');

      expect(loansRepository.find).toHaveBeenCalledWith({
        where: { clientId: 'client-1', status: LoanStatus.Active },
        select: { id: true },
      });
      expect(getPayoffQuote).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({
        activeLoanCount: 2,
        principalBalance: 1400000,
        payoffTotal: 1650000,
      });
    });

    it('is all zeros for a client with no active loan', async () => {
      loansRepository.find.mockResolvedValue([]);

      await expect(service.getClientDebtSummary('client-1')).resolves.toEqual({
        activeLoanCount: 0,
        principalBalance: 0,
        payoffTotal: 0,
      });
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

    // Human decision, 2026-09-26 — early payoff uses the same grace-period
    // rule refinancing has used since Phase 25, corrected 2026-09-30: a
    // cuota whose period started at least 5 days ago is treated as already
    // matured, so liquidating and refinancing the same loan on the same day
    // charge the same interest.
    describe('interest accrual grace period (same as refinancing)', () => {
      it('includes the interest of a cuota whose period started exactly 5 days ago', async () => {
        loansRepository.findOneBy.mockResolvedValue({
          ...mockLoan,
          disbursedAt: bogotaTodayPlusDays(-5),
        });
        installmentsRepository.find.mockResolvedValue([
          pendingInstallment({
            amount: 300000,
            principalPortion: 270000,
            // Weeks away — genuinely not yet due; only the period-start
            // grace period should be what matures this installment.
            dueDate: bogotaTodayPlusDays(60),
          }),
        ]);

        const quote = await service.getPayoffQuote(mockLoan.id);

        // amount − principalPortion = 30000 of corriente interest.
        expect(quote.totalInterestOwed).toBe(30000);
        expect(quote.totalPrincipalOwed).toBe(270000);
        expect(quote.totalDue).toBe(300000);
      });

      it('charges only the capital of a cuota whose period started 4 days ago (still inside the grace period)', async () => {
        loansRepository.findOneBy.mockResolvedValue({
          ...mockLoan,
          disbursedAt: bogotaTodayPlusDays(-4),
        });
        installmentsRepository.find.mockResolvedValue([
          pendingInstallment({
            amount: 300000,
            principalPortion: 270000,
            dueDate: bogotaTodayPlusDays(60),
          }),
        ]);

        const quote = await service.getPayoffQuote(mockLoan.id);

        expect(quote.totalInterestOwed).toBe(0);
        expect(quote.totalDue).toBe(270000);
      });

      it('agrees with the refinance quote for the same loan on the same day', async () => {
        installmentsRepository.find.mockResolvedValue([
          pendingInstallment({
            amount: 300000,
            principalPortion: 270000,
            dueDate: bogotaTodayPlusDays(3),
          }),
        ]);
        installmentsRepository.findOne.mockResolvedValue(
          pendingInstallment({ id: 'inst-1' }),
        );

        const payoffQuote = await service.getPayoffQuote(mockLoan.id);
        const refinanceQuote = await service.getRefinanceQuote(mockLoan.id);

        expect(payoffQuote.totalDue).toBe(refinanceQuote.payoff.totalDue);
        expect(payoffQuote.totalInterestOwed).toBe(
          refinanceQuote.payoff.totalInterestOwed,
        );
      });

      it('leaves the "saldo capital a la fecha" untouched (principal never depends on the grace period)', async () => {
        installmentsRepository.find.mockResolvedValue([
          pendingInstallment({
            amount: 300000,
            principalPortion: 270000,
            dueDate: bogotaTodayPlusDays(2),
          }),
        ]);

        const quote = await service.getPayoffQuote(mockLoan.id);

        expect(quote.totalPrincipalOwed).toBe(270000);
      });
    });

    it('quotes only interest/principal for still-pending installments', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({ amount: 300000, principalPortion: 270000 }),
      ]);

      const quote = await service.getPayoffQuote(mockLoan.id);

      // Style cleanup, 2026-09-30 — now fetches the loan's FULL installment
      // list (not status-filtered), so periodStartDate can be computed from
      // the previous installment's dueDate too; still filters to Pending
      // in memory before building the quote.
      expect(installmentsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { loanId: mockLoan.id },
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

    // Bug fix, 2026-09-15 (human report) — used to quote a Pending
    // installment at its full nominal cost even when a prior partial
    // payment already existed on it, the same class of bug as préstamo
    // #0920's overcharge (see calculatePayoff.spec.ts's dedicated
    // "totalPaid netting" suite for the underlying math this exercises).
    it('nets an existing partial payment off the quoted amount', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({ amount: 300000, principalPortion: 270000 }),
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 100000 },
      ]);

      const quote = await service.getPayoffQuote(mockLoan.id);

      // Gross: conceptsInterest 300000-270000=30000, no moratory concepts
      // mocked in this suite so moratoryInterest is always 0 regardless of
      // real elapsed days — deterministic. totalPaid 100000 clears the
      // 30000 interest first (Art. 1653), the remaining 70000 comes off
      // principal: 270000 - 70000 = 200000.
      expect(quote.installments[0].totalDue).toBe(200000);
      expect(quote.totalPrincipalOwed).toBe(200000);
    });
  });

  // Human request, 2026-11-05 — the terms a loan was created with, back
  // through every loan it was refinanced from.
  describe('getOriginationTerms', () => {
    const original: Loan = {
      ...mockLoan,
      id: 'loan-0',
      status: LoanStatus.Refinanced,
      refinancedFromLoanId: null,
    };
    const current: Loan = {
      ...mockLoan,
      id: 'loan-1',
      refinancedFromLoanId: 'loan-0',
      refinanceMoraWaivedAmount: 45000,
      refinanceMoraWaiverReason: 'Refinancia al día',
    };

    function mockLoans(loans: Loan[]): void {
      loansRepository.findOneBy.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(loans.find((loan) => loan.id === id) ?? null),
      );
    }

    beforeEach(() => {
      installmentsRepository.find.mockImplementation(
        ({ where }: { where: { loanId: string } }) =>
          Promise.resolve([
            {
              id: `${where.loanId}-inst-1`,
              installmentNumber: 1,
              amount: 300000,
              isDownPayment: false,
              status: InstallmentStatus.Pending,
            },
          ]),
      );
      loanInstallmentConceptsRepository.find.mockImplementation(
        ({ where }: { where: { installmentId: string } }) =>
          Promise.resolve([
            {
              installmentId: where.installmentId,
              interestConceptTypeId: null,
              nameSnapshot: 'Intereses corrientes',
              calculationType: ConceptCalculationType.Percentage,
              category: ConceptCategory.Corriente,
              value: where.installmentId.startsWith('loan-0') ? 4.2 : 3.9,
            },
          ]),
      );
    });

    it('returns this loan first, then the one it was refinanced from, each with its own rate', async () => {
      mockLoans([current, original]);

      const terms = await service.getOriginationTerms('loan-1');

      expect(terms.map((item) => item.loanId)).toEqual(['loan-1', 'loan-0']);
      expect(terms[0]).toMatchObject({
        corrienteInterestRate: 3.9,
        moratoryInterestRate: null,
        refinanceMoraWaivedAmount: 45000,
        refinanceMoraWaiverReason: 'Refinancia al día',
      });
      expect(terms[1].corrienteInterestRate).toBe(4.2);
    });

    it('stops at a link that no longer exists', async () => {
      mockLoans([current]);

      const terms = await service.getOriginationTerms('loan-1');

      expect(terms).toHaveLength(1);
    });

    it('never loops on a corrupt refinance cycle', async () => {
      mockLoans([current, { ...original, refinancedFromLoanId: 'loan-1' }]);

      const terms = await service.getOriginationTerms('loan-1');

      expect(terms.map((item) => item.loanId)).toEqual(['loan-1', 'loan-0']);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      mockLoans([]);

      await expect(service.getOriginationTerms('missing')).rejects.toThrow(
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
      // total is exactly principalPortion, regardless of when this test
      // runs. Disbursed today too (installment #1's period starts at
      // disbursedAt — see buildPeriodStartDates), so the grace period
      // hasn't elapsed either.
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(0),
      });

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

    // Bug fix, 2026-09-15 (human report) — suggestedPrincipalAmount reuses
    // calculatePayoff() (see this describe block's own header comment), so
    // it had the same "recharges a partially-paid pending cuota" gap as
    // getPayoffQuote/payoff.
    it('nets an existing partial payment off the suggested principal', async () => {
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(0),
      });

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
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 70000 },
      ]);

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.suggestedPrincipalAmount).toBe(200000); // 270000 - 70000
    });

    // Human request, 2026-11-05 — see calculateRefinanceMaxMoraWaiver.
    it("reports the overdue cuotas' accrued mora as the most that can be forgiven", async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({ dueDate: '2020-01-01' }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(pendingInstallment());
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'inst-1',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 2,
          interestConceptTypeId: null,
        },
      ]);

      const quote = await service.getRefinanceQuote(mockLoan.id);

      const moraItems = quote.payoff.installments[0].conceptBreakdown.filter(
        (item) => item.category === ConceptCategory.Moratorio,
      );
      expect(moraItems.length).toBe(1);
      expect(quote.maxMoraWaivable).toBeGreaterThan(0);
      expect(quote.maxMoraWaivable).toBe(
        calculateMoraCharged(300000, moraItems[0].amount),
      );
    });

    it('reports nothing to forgive when no cuota is overdue', async () => {
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(0),
      });
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          dueDate: futureDueDate.toISOString().slice(0, 10),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(pendingInstallment());

      const quote = await service.getRefinanceQuote(mockLoan.id);

      expect(quote.maxMoraWaivable).toBe(0);
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
    it('does not add extra interest for an installment whose period only just started', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(0),
      });
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

    it('folds an installment into the new principal once its period has run for the grace period, corriente interest only (not yet actually overdue)', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(-5),
      });
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          // Weeks away — genuinely not yet due; only the grace period
          // (5 days since disbursedAt, installment #1's period start)
          // should be what folds this in.
          dueDate: bogotaTodayPlusDays(25),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );

      const quote = await service.getRefinanceQuote(mockLoan.id);

      // principalPortion (270000) + corriente interest already baked into
      // the cuota (300000 - 270000 = 30000) + 0 moratory, since no real
      // mora has accrued yet (overdueDays is still 0 weeks out).
      expect(quote.suggestedPrincipalAmount).toBe(300000);
    });

    it('includes both corriente and moratory interest for an actually overdue installment (hand-calculated)', async () => {
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          amount: 300000,
          principalPortion: 270000,
          // 10 days — past the mora grace period (see
          // installmentCalculations.ts's MORA_GRACE_PERIOD_DAYS), so this
          // keeps testing genuine moratory interest, not the grace period.
          dueDate: bogotaTodayPlusDays(-10),
        }),
      ]);
      installmentsRepository.findOne.mockResolvedValue(
        pendingInstallment({ id: 'inst-1' }),
      );
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'inst-1',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
        },
      ]);

      const quote = await service.getRefinanceQuote(mockLoan.id);

      // Hand-calculated: principalPortion 270000 + corriente (300000 -
      // 270000 = 30000) + moratory (300000 * 6/100 / 30) * 10 days = 6000
      // → 270000 + 30000 + 6000 = 306000.
      expect(quote.suggestedPrincipalAmount).toBe(306000);
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
      // of when this test actually runs. Disbursed today too, so the
      // grace period (counted from installment #1's period start,
      // disbursedAt) hasn't elapsed either.
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(0),
      });

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

    // Human decision, 2026-09-26, corrected 2026-09-30 — payoff() charges
    // exactly what getPayoffQuote() quotes, including the grace period: a
    // cuota whose period has run for 5+ days is settled for its capital AND
    // its interest, not capital alone, even if its own due date is weeks
    // away.
    it('charges a cuota past its grace period its interest too, matching the quote', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(-5),
      });
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          id: 'inst-1',
          amount: 300000,
          principalPortion: 270000,
          dueDate: bogotaTodayPlusDays(25),
        }),
      ]);

      const quote = await service.getPayoffQuote(mockLoan.id);
      await service.payoff(mockLoan.id);

      expect(quote.totalDue).toBe(300000);
      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentId: 'inst-1',
          amountPaid: 300000,
        }),
      );
    });

    it('still charges only the capital of a cuota whose period started less than 5 days ago', async () => {
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(-4),
      });
      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          id: 'inst-1',
          amount: 300000,
          principalPortion: 270000,
          dueDate: bogotaTodayPlusDays(25),
        }),
      ]);

      await service.payoff(mockLoan.id);

      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentId: 'inst-1',
          amountPaid: 270000,
        }),
      );
    });

    // Human report, 2026-09-25 — the payoff dialog had no way to attach the
    // payment receipt.
    describe('payment receipt photos', () => {
      const futureDueDate = () => {
        const date = new Date();
        date.setFullYear(date.getFullYear() + 5);
        return date.toISOString().slice(0, 10);
      };
      const twoPending = () => [
        pendingInstallment({
          id: 'inst-1',
          installmentNumber: 1,
          dueDate: futureDueDate(),
        }),
        pendingInstallment({
          id: 'inst-2',
          installmentNumber: 2,
          dueDate: futureDueDate(),
        }),
      ];

      it('attaches the same receipt photos to every payment the payoff registers', async () => {
        installmentsRepository.find.mockResolvedValue(twoPending());
        paymentsRepository.save.mockImplementation((payments: unknown[]) =>
          Promise.resolve(
            (payments as { installmentId: string }[]).map((payment, index) => ({
              ...payment,
              id: `payment-${index + 1}`,
            })),
          ),
        );

        await service.payoff(mockLoan.id, {
          imageUrls: [
            'https://res.cloudinary.com/x/receipt-1.jpg',
            'https://res.cloudinary.com/x/receipt-2.jpg',
          ],
        });

        expect(paymentImagesRepository.save).toHaveBeenCalledWith([
          {
            paymentId: 'payment-1',
            imageUrl: 'https://res.cloudinary.com/x/receipt-1.jpg',
          },
          {
            paymentId: 'payment-1',
            imageUrl: 'https://res.cloudinary.com/x/receipt-2.jpg',
          },
          {
            paymentId: 'payment-2',
            imageUrl: 'https://res.cloudinary.com/x/receipt-1.jpg',
          },
          {
            paymentId: 'payment-2',
            imageUrl: 'https://res.cloudinary.com/x/receipt-2.jpg',
          },
        ]);
      });

      it('saves no images when none are given (empty body, as before)', async () => {
        installmentsRepository.find.mockResolvedValue(twoPending());

        await service.payoff(mockLoan.id);
        await service.payoff(mockLoan.id, {});
        await service.payoff(mockLoan.id, { imageUrls: [] });

        expect(paymentImagesRepository.save).not.toHaveBeenCalled();
      });
    });

    // Human report, 2026-10-21 — the payoff had no way to record why or
    // how the client paid.
    describe('observation', () => {
      beforeEach(() => {
        const futureDueDate = new Date();
        futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);
        installmentsRepository.find.mockResolvedValue([
          pendingInstallment({
            id: 'inst-1',
            installmentNumber: 1,
            dueDate: futureDueDate.toISOString().slice(0, 10),
          }),
          pendingInstallment({
            id: 'inst-2',
            installmentNumber: 2,
            dueDate: futureDueDate.toISOString().slice(0, 10),
          }),
        ]);
      });

      it("appends the admin's detail after the fixed label on every payment", async () => {
        await service.payoff(mockLoan.id, {
          observation: '  Pagó con transferencia, vendió la moto ',
        });

        const observations = paymentsRepository.create.mock.calls.map(
          ([payment]: [{ observation: string }]) => payment.observation,
        );
        expect(observations).toEqual([
          'Liquidación anticipada — Pagó con transferencia, vendió la moto',
          'Liquidación anticipada — Pagó con transferencia, vendió la moto',
        ]);
      });

      it('keeps the plain label when the detail is blank', async () => {
        await service.payoff(mockLoan.id, { observation: '   ' });

        const observations = paymentsRepository.create.mock.calls.map(
          ([payment]: [{ observation: string }]) => payment.observation,
        );
        expect(observations).toEqual([
          'Liquidación anticipada',
          'Liquidación anticipada',
        ]);
      });
    });

    // Bug fix, 2026-09-15 (human report) — before this, payoff() recharged
    // an installment's full amount even when a prior partial payment
    // already existed on it, so the client effectively paid twice for the
    // same cuota (the same class of bug as préstamo #0920's overcharge).
    it('nets an existing partial payment before registering the payoff payment', async () => {
      const futureDueDate = new Date();
      futureDueDate.setFullYear(futureDueDate.getFullYear() + 5);
      loansRepository.findOneBy.mockResolvedValue({
        ...mockLoan,
        disbursedAt: bogotaTodayPlusDays(0),
      });

      installmentsRepository.find.mockResolvedValue([
        pendingInstallment({
          id: 'inst-1',
          amount: 300000,
          principalPortion: 270000,
          dueDate: futureDueDate.toISOString().slice(0, 10),
        }),
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 100000 },
      ]);

      await service.payoff(mockLoan.id);

      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentId: 'inst-1',
          amountPaid: 170000, // 270000 - 100000, not the full 270000 again
          observation: 'Liquidación anticipada',
        }),
      );
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
