import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { ClientsService } from './clients.service';
import { Client, DocumentType } from './entities/client.entity';
import { ClientMessageFrequency } from './entities/clientMessageFrequency.entity';
import {
  ClientReference,
  ClientReferenceType,
} from './entities/clientReference.entity';

describe('ClientsService', () => {
  let service: ClientsService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    softDelete: jest.Mock;
    find: jest.Mock;
    restore: jest.Mock;
  };
  let loansRepository: { count: jest.Mock; find: jest.Mock };
  let installmentsRepository: { find: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let clientReferencesRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    remove: jest.Mock;
  };
  let clientMessageFrequenciesRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
  };

  const mockClient: Client = {
    id: 'client-1',
    firstName: 'Juana',
    lastName: 'Pérez',
    documentNumber: '1234567890',
    phoneNumber: '+573001234567',
    creditLimit: null,
    documentType: null,
    dateOfBirth: null,
    gender: null,
    documentIssuePlace: null,
    documentIssueDate: null,
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
    dataProcessingConsent: true,
    consentGivenAt: new Date(),
    consentDocumentUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  // enrichInstallment always compares against the real `new Date()` (it
  // doesn't take a `today` param), so any test asserting an exact
  // overdueDays value needs "now" pinned — otherwise a date built from the
  // real clock is one flaky day away from crossing a day boundary mid-run.
  // Fixed at noon UTC; dueDate strings below are always UTC midnight, so
  // there's a comfortable 12h margin on both sides of every day-count
  // assertion, including the >30-days boundary.
  const FIXED_NOW = new Date('2026-06-15T12:00:00Z');
  const daysAgo = (n: number): string => {
    const date = new Date(FIXED_NOW);
    date.setUTCDate(date.getUTCDate() - n);
    return date.toISOString().slice(0, 10);
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((dto: Partial<Client>) => dto),
      save: jest.fn(),
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      softDelete: jest.fn(),
      find: jest.fn(),
      restore: jest.fn(),
    };
    loansRepository = {
      count: jest.fn().mockResolvedValue(0),
      // Defaults to no active loans at all — findAll() now enriches every
      // page via enrichClientListItems(), which unconditionally calls
      // loansRepository.find(); without this default, every findAll test
      // below that doesn't care about activeLoanCount/maxOverdueDays would
      // otherwise crash on `loans.map(...)` over an unmocked (undefined)
      // result. Tests that DO care override this per-case.
      find: jest.fn().mockResolvedValue([]),
    };
    installmentsRepository = { find: jest.fn() };
    // Bug fix, 2026-09-07 — defaults to no payments found, so
    // enrichActiveInstallments' new sumPaymentsByInstallmentId call has
    // something iterable rather than undefined in every existing test that
    // doesn't care about partial-payment scenarios. Tests that DO care
    // override this per-case, same convention as loansRepository above.
    paymentsRepository = { find: jest.fn().mockResolvedValue([]) };
    // Bug fix, 2026-09-08 — defaults to no concepts assigned, so
    // enrichActiveInstallments' new findConceptsByInstallmentId call has
    // something iterable rather than undefined in every existing test that
    // doesn't care about moratory-concept scenarios. Tests that DO care
    // override this per-case, same convention as paymentsRepository above.
    loanInstallmentConceptsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    clientReferencesRepository = {
      create: jest.fn((dto: Partial<ClientReference>) => dto),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
      remove: jest.fn(),
    };
    clientMessageFrequenciesRepository = {
      // Spread into a new object, not the same reference — the service
      // mutates the entity returned by create() (sets
      // minimumDaysBetweenMessages after the fact), so an identity-echoing
      // mock like `(dto) => dto` would let that later mutation leak
      // backward into what toHaveBeenCalledWith() already recorded.
      create: jest.fn((dto: Partial<ClientMessageFrequency>) => ({ ...dto })),
      save: jest.fn(),
      findOneBy: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: getRepositoryToken(Client), useValue: repository },
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
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
        },
        {
          provide: getRepositoryToken(ClientReference),
          useValue: clientReferencesRepository,
        },
        {
          provide: getRepositoryToken(ClientMessageFrequency),
          useValue: clientMessageFrequenciesRepository,
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);

    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    const createDto = {
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
      documentType: DocumentType.CedulaCiudadania,
      dataProcessingConsent: true,
      // Phase 26 — at least one address is required unconditionally now;
      // set here so every test in this describe block that isn't
      // specifically about the address rule itself doesn't have to repeat
      // it. See the dedicated 'at least one address' tests below.
      homeAddress: 'Cra 1 #2-3',
    };

    it('creates a client when the document number is not in use', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockResolvedValue(mockClient);

      const result = await service.create(createDto);

      expect(result).toEqual(mockClient);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { documentNumber: createDto.documentNumber },
        withDeleted: true,
      });
    });

    it('rejects a duplicate document number with ConflictException, not a raw DB error', async () => {
      repository.findOne.mockResolvedValue(mockClient);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    // Phase 21 — dataProcessingConsent is required through this path
    // (ClientsController.create), never through the bulk-import path
    // (ClientLoanImportService, which opts out explicitly). See
    // docs/phases/PHASE_21_CLIENT_PROFILE.md decision 6.
    it('rejects creating a client without data-processing consent', async () => {
      await expect(
        service.create({ ...createDto, dataProcessingConsent: false }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects creating a client when consent is omitted entirely', async () => {
      const withoutConsent = {
        firstName: createDto.firstName,
        lastName: createDto.lastName,
        documentNumber: createDto.documentNumber,
        phoneNumber: createDto.phoneNumber,
        homeAddress: createDto.homeAddress,
      };

      await expect(service.create(withoutConsent)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    // Client requested this be mandatory on the interactive create path,
    // same requireX/Excel-exempt pattern as dataProcessingConsent above.
    it('rejects creating a client without a document type', async () => {
      const withoutDocumentType = {
        firstName: createDto.firstName,
        lastName: createDto.lastName,
        documentNumber: createDto.documentNumber,
        phoneNumber: createDto.phoneNumber,
        dataProcessingConsent: createDto.dataProcessingConsent,
        homeAddress: createDto.homeAddress,
      };

      await expect(service.create(withoutDocumentType)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('does not require a document type when explicitly opted out (Excel import path)', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockResolvedValue(mockClient);

      const withoutDocumentType = {
        firstName: createDto.firstName,
        lastName: createDto.lastName,
        documentNumber: createDto.documentNumber,
        phoneNumber: createDto.phoneNumber,
        homeAddress: createDto.homeAddress,
      };
      await expect(
        service.create(withoutDocumentType, {
          requireConsent: false,
          requireDocumentType: false,
        }),
      ).resolves.toEqual(mockClient);
    });

    it('stamps consentGivenAt with the server clock when consent is given', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockImplementation((client: Partial<Client>) =>
        Promise.resolve({ ...mockClient, ...client }),
      );

      await service.create(createDto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ consentGivenAt: FIXED_NOW }),
      );
    });

    it('does not require consent when explicitly opted out (Excel import path)', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockResolvedValue(mockClient);

      const withoutConsent = {
        firstName: createDto.firstName,
        lastName: createDto.lastName,
        documentNumber: createDto.documentNumber,
        phoneNumber: createDto.phoneNumber,
        homeAddress: createDto.homeAddress,
      };
      await expect(
        service.create(withoutConsent, { requireConsent: false }),
      ).resolves.toEqual(mockClient);
    });

    // Phase 26 — confirmed with the human (2026-08-30): unlike consent and
    // documentType, this rule is NOT exempted anywhere, including bulk
    // import (see ClientLoanImportService, which catches this
    // BadRequestException per-row via its existing error-handling path —
    // no import-specific test needed here, that's covered on the
    // ClientLoanImportService side).
    it('rejects creating a client with no address at all', async () => {
      const withoutAddress = {
        firstName: createDto.firstName,
        lastName: createDto.lastName,
        documentNumber: createDto.documentNumber,
        phoneNumber: createDto.phoneNumber,
        documentType: createDto.documentType,
        dataProcessingConsent: createDto.dataProcessingConsent,
      };

      await expect(service.create(withoutAddress)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('accepts a client with only a work address (no home address)', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockResolvedValue(mockClient);

      const workAddressOnly = {
        firstName: createDto.firstName,
        lastName: createDto.lastName,
        documentNumber: createDto.documentNumber,
        phoneNumber: createDto.phoneNumber,
        documentType: createDto.documentType,
        dataProcessingConsent: createDto.dataProcessingConsent,
        workAddress: 'Av. Siempre Viva 742',
      };

      await expect(service.create(workAddressOnly)).resolves.toEqual(
        mockClient,
      );
    });

    it('rejects a client whose address fields are present but blank', async () => {
      const blankAddresses = {
        ...createDto,
        homeAddress: '   ',
        workAddress: '',
      };

      await expect(service.create(blankAddresses)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the client when found', async () => {
      repository.findOneBy.mockResolvedValue(mockClient);

      const result = await service.findOne(mockClient.id);

      expect(result).toEqual(mockClient);
    });

    it('throws NotFoundException when the client does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the client when found and the document number is unchanged', async () => {
      repository.findOneBy.mockResolvedValue(mockClient);
      repository.save.mockResolvedValue({
        ...mockClient,
        firstName: 'Juanita',
      });

      const result = await service.update(mockClient.id, {
        firstName: 'Juanita',
      });

      expect(result.firstName).toBe('Juanita');
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the client does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { firstName: 'Juanita' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects updating to a document number already used by another client', async () => {
      repository.findOneBy.mockResolvedValue(mockClient);
      repository.findOne.mockResolvedValue({
        ...mockClient,
        id: 'other-client',
      });

      await expect(
        service.update(mockClient.id, { documentNumber: '9999999999' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    // Phase 21 — consentGivenAt is stamped with the server clock only when
    // consent actually transitions to true, not on every unrelated update.
    it('stamps consentGivenAt when consent newly transitions to true', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        dataProcessingConsent: false,
        consentGivenAt: null,
      });
      repository.save.mockImplementation((client: Client) =>
        Promise.resolve(client),
      );

      const result = await service.update(mockClient.id, {
        dataProcessingConsent: true,
      });

      expect(result.consentGivenAt).toEqual(FIXED_NOW);
    });

    it('does not touch consentGivenAt when consent was already true', async () => {
      const alreadyGivenAt = new Date('2026-01-01T00:00:00Z');
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        dataProcessingConsent: true,
        consentGivenAt: alreadyGivenAt,
      });
      repository.save.mockImplementation((client: Client) =>
        Promise.resolve(client),
      );

      const result = await service.update(mockClient.id, {
        firstName: 'Juanita',
      });

      expect(result.consentGivenAt).toEqual(alreadyGivenAt);
    });
  });

  describe('softDelete', () => {
    it('soft-deletes the client when found and has no loans', async () => {
      repository.findOneBy.mockResolvedValue(mockClient);
      loansRepository.count.mockResolvedValue(0);

      await service.softDelete(mockClient.id);

      expect(loansRepository.count).toHaveBeenCalledWith({
        where: { clientId: mockClient.id },
      });
      expect(repository.softDelete).toHaveBeenCalledWith({ id: mockClient.id });
    });

    it('throws NotFoundException when the client does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.softDelete('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.softDelete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the client has loans, without deleting', async () => {
      repository.findOneBy.mockResolvedValue(mockClient);
      loansRepository.count.mockResolvedValue(2);

      await expect(service.softDelete(mockClient.id)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns a paginated page of active clients by default', async () => {
      repository.find.mockResolvedValue([mockClient]);

      const result = await service.findAll({});

      expect(result).toEqual({
        items: [{ ...mockClient, activeLoanCount: 0, maxOverdueDays: 0 }],
        meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
      expect(repository.find).toHaveBeenCalledWith({
        where: {},
        withDeleted: false,
      });
    });

    it('filters to soft-deleted clients when isActive is false', async () => {
      repository.find.mockResolvedValue([]);

      await service.findAll({ isActive: false });

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          deletedAt: expect.objectContaining({ _type: 'not' }) as unknown,
        },
        withDeleted: true,
      });
    });

    it('applies no deletedAt filter at all when isActive is "all"', async () => {
      repository.find.mockResolvedValue([mockClient]);

      await service.findAll({ isActive: 'all' });

      expect(repository.find).toHaveBeenCalledWith({
        where: {},
        withDeleted: true,
      });
    });

    it('applies the search term as an OR across name, document, and phone', async () => {
      repository.find.mockResolvedValue([mockClient]);

      await service.findAll({ search: 'Juana' });

      const [[callArg]] = repository.find.mock.calls as [
        [{ where: Record<string, unknown>[] }],
      ];
      expect(callArg.where).toHaveLength(4);
      for (const condition of callArg.where) {
        const [, operator] = Object.entries(condition).find(
          ([key]) => key !== 'deletedAt',
        )!;
        expect(operator).toMatchObject({ _type: 'ilike', _value: '%Juana%' });
      }
    });

    it('sorts alphabetically by first name then last name, accent- and case-insensitively', async () => {
      const andres = { ...mockClient, id: 'c1', firstName: 'Ándres' };
      const beatriz = { ...mockClient, id: 'c2', firstName: 'beatriz' };
      const carlos = { ...mockClient, id: 'c3', firstName: 'Carlos' };
      repository.find.mockResolvedValue([carlos, andres, beatriz]);

      const result = await service.findAll({});

      expect(result.items.map((client) => client.id)).toEqual([
        'c1',
        'c2',
        'c3',
      ]);
    });

    it('respects custom page and limit', async () => {
      repository.find.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => ({
          ...mockClient,
          id: `client-${i}`,
        })),
      );

      const result = await service.findAll({ page: 2, limit: 5 });

      expect(result.items).toHaveLength(5);
      expect(result.meta).toEqual({
        page: 2,
        limit: 5,
        total: 12,
        totalPages: 3,
      });
    });

    // "Préstamos activos" + "En mora" columns on ClientsListPage.tsx (client
    // request, 2026-09-05) — exercised here through findAll() since
    // enrichClientListItems is private. maxOverdueDays uses the same "any
    // overdueDays > 0" definition as ClientDetailPage's own "En mora" stat,
    // not the stricter >30-day hasMoraBlock threshold.
    describe('enrichClientListItems (Préstamos activos + En mora)', () => {
      it('batches exactly two queries regardless of how many clients are on the page', async () => {
        const clientTwo = { ...mockClient, id: 'client-2' };
        repository.find.mockResolvedValue([mockClient, clientTwo]);
        loansRepository.find.mockResolvedValue([
          { id: 'loan-1', clientId: mockClient.id },
          { id: 'loan-2', clientId: clientTwo.id },
        ]);
        installmentsRepository.find.mockResolvedValue([]);

        await service.findAll({});

        expect(loansRepository.find).toHaveBeenCalledTimes(1);
        expect(loansRepository.find).toHaveBeenCalledWith({
          where: {
            clientId: expect.objectContaining({ _type: 'in' }) as unknown,
            status: LoanStatus.Active,
          },
        });
        expect(installmentsRepository.find).toHaveBeenCalledTimes(1);
        expect(installmentsRepository.find).toHaveBeenCalledWith({
          where: {
            loanId: expect.objectContaining({ _type: 'in' }) as unknown,
          },
        });
      });

      it('skips the installments query entirely when no client on the page has an active loan', async () => {
        repository.find.mockResolvedValue([mockClient]);
        loansRepository.find.mockResolvedValue([]);

        const result = await service.findAll({});

        expect(result.items[0]).toMatchObject({
          activeLoanCount: 0,
          maxOverdueDays: 0,
        });
        expect(installmentsRepository.find).not.toHaveBeenCalled();
      });

      it('counts active loans per client', async () => {
        const clientTwo = { ...mockClient, id: 'client-2' };
        repository.find.mockResolvedValue([mockClient, clientTwo]);
        loansRepository.find.mockResolvedValue([
          { id: 'loan-1', clientId: mockClient.id },
          { id: 'loan-2', clientId: mockClient.id },
          { id: 'loan-3', clientId: clientTwo.id },
        ]);
        installmentsRepository.find.mockResolvedValue([]);

        const result = await service.findAll({});

        expect(result.items.find((c) => c.id === mockClient.id)).toMatchObject({
          activeLoanCount: 2,
        });
        expect(result.items.find((c) => c.id === clientTwo.id)).toMatchObject({
          activeLoanCount: 1,
        });
      });

      it('takes the maximum overdueDays across a client’s loans, ignoring non-overdue installments', async () => {
        loansRepository.find.mockResolvedValue([
          { id: 'loan-1', clientId: mockClient.id },
          { id: 'loan-2', clientId: mockClient.id },
        ]);
        installmentsRepository.find.mockResolvedValue([
          {
            id: 'inst-1',
            loanId: 'loan-1',
            amount: 300,
            dueDate: daysAgo(5),
            status: InstallmentStatus.Pending,
          },
          {
            id: 'inst-2',
            loanId: 'loan-2',
            amount: 300,
            dueDate: daysAgo(20),
            status: InstallmentStatus.Pending,
          },
          {
            id: 'inst-3',
            loanId: 'loan-1',
            amount: 300,
            dueDate: daysAgo(-10), // not yet due — not overdue
            status: InstallmentStatus.Pending,
          },
        ]);
        repository.find.mockResolvedValue([mockClient]);

        const result = await service.findAll({});

        expect(result.items[0]).toMatchObject({ maxOverdueDays: 20 });
      });

      it('reports maxOverdueDays 0 for a client whose active-loan installments are all current', async () => {
        repository.find.mockResolvedValue([mockClient]);
        loansRepository.find.mockResolvedValue([
          { id: 'loan-1', clientId: mockClient.id },
        ]);
        installmentsRepository.find.mockResolvedValue([
          {
            id: 'inst-1',
            loanId: 'loan-1',
            amount: 300,
            dueDate: daysAgo(-5),
            status: InstallmentStatus.Pending,
          },
        ]);

        const result = await service.findAll({});

        expect(result.items[0]).toMatchObject({ maxOverdueDays: 0 });
      });

      it('never lets a >30-day overdue installment silently disappear (uses the loose En mora definition, not hasMoraBlock’s threshold)', async () => {
        repository.find.mockResolvedValue([mockClient]);
        loansRepository.find.mockResolvedValue([
          { id: 'loan-1', clientId: mockClient.id },
        ]);
        installmentsRepository.find.mockResolvedValue([
          {
            id: 'inst-1',
            loanId: 'loan-1',
            amount: 300,
            dueDate: daysAgo(45),
            status: InstallmentStatus.Pending,
          },
        ]);

        const result = await service.findAll({});

        expect(result.items[0]).toMatchObject({ maxOverdueDays: 45 });
      });
    });
  });

  // "Cupo usado" = capital + interés acumulado across still-pending
  // installments on the client's active loans, per the confirmed rule in
  // docs/phases/PHASE_10_CLIENT_CAPACITY.md / docs/DATABASE.md.
  describe('getCreditUsage', () => {
    it('returns zero used and full cupo available when the client has no active loans', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000,
      });
      loansRepository.find.mockResolvedValue([]);

      const result = await service.getCreditUsage(mockClient.id);

      expect(result).toEqual({
        creditLimit: 1000,
        creditUsed: 0,
        creditAvailable: 1000,
      });
      expect(installmentsRepository.find).not.toHaveBeenCalled();
    });

    it('sums amount (no accrued interest) for pending installments that are not yet due', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000,
      });
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(-10), // still 10 days out
          status: InstallmentStatus.Pending,
        },
      ]);

      const result = await service.getCreditUsage(mockClient.id);

      expect(result).toEqual({
        creditLimit: 1000,
        creditUsed: 300,
        creditAvailable: 700,
      });
    });

    it('adds accrued interest for overdue pending installments', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000000,
      });
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          // Bug fix, 2026-09-14 — bumped from 300 to a realistic loan scale
          // (see calculateTotalDue's own comment): totalDue now rounds to
          // the nearest $100, which would have silently erased the whole
          // $3 of accrued interest this test exists to check for at the
          // old scale, making it pass for the wrong reason.
          amount: 300000,
          dueDate: daysAgo(10),
          status: InstallmentStatus.Pending,
        },
      ]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'inst-1',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 3,
        },
      ]);

      const result = await service.getCreditUsage(mockClient.id);

      // 300000 + (300000 * 0.03 / 30) * 10 = 300000 + 3000 = 303000
      // (already an exact multiple of $100, so the rounding above is a
      // no-op here — the point of this test is the interest being added
      // at all, not the rounding itself, which installmentCalculations.spec.ts
      // covers directly).
      expect(result.creditUsed).toBe(303000);
      expect(result.creditAvailable).toBe(697000);
    });

    it('ignores paid and cancelled installments', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000,
      });
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(10),
          status: InstallmentStatus.Paid,
        },
        {
          id: 'inst-2',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(10),
          status: InstallmentStatus.Cancelled,
        },
      ]);

      const result = await service.getCreditUsage(mockClient.id);

      expect(result.creditUsed).toBe(0);
    });

    // Bug fix, 2026-09-07 — before this, creditUsed never netted out a
    // partial payment already made on a Pending installment, so a client's
    // cupo stayed fully "used" even after money had genuinely come in.
    it('subtracts an existing partial payment from creditUsed', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000,
      });
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(-10), // not overdue — deterministic totalDue
          status: InstallmentStatus.Pending,
        },
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 120 },
      ]);

      const result = await service.getCreditUsage(mockClient.id);

      expect(result).toEqual({
        creditLimit: 1000,
        creditUsed: 180,
        creditAvailable: 820,
      });
    });

    it('returns null creditAvailable when the client has no cupo set', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: null,
      });
      loansRepository.find.mockResolvedValue([]);

      const result = await service.getCreditUsage(mockClient.id);

      expect(result).toEqual({
        creditLimit: null,
        creditUsed: 0,
        creditAvailable: null,
      });
    });

    it('only counts loans that are Active, excluding refinanced/paid loans', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000,
      });
      // The service filters by status: Active in its query — this asserts
      // that filter is actually applied, not just documented.
      loansRepository.find.mockResolvedValue([]);

      await service.getCreditUsage(mockClient.id);

      expect(loansRepository.find).toHaveBeenCalledWith({
        where: { clientId: mockClient.id, status: LoanStatus.Active },
      });
    });
  });

  // Per-installment, not client-aggregate — confirmed with the human for
  // Phase 10 (see docs/phases/PHASE_10_CLIENT_CAPACITY.md).
  describe('hasMoraBlock', () => {
    it('is false when the client has no active loans', async () => {
      loansRepository.find.mockResolvedValue([]);

      expect(await service.hasMoraBlock(mockClient.id)).toBe(false);
    });

    it('is false when every pending installment is 30 days overdue or less', async () => {
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(30),
          status: InstallmentStatus.Pending,
        },
      ]);

      expect(await service.hasMoraBlock(mockClient.id)).toBe(false);
    });

    it('is true when any single pending installment is more than 30 days overdue', async () => {
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
        { id: 'loan-2', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(5),
          status: InstallmentStatus.Pending,
        },
        {
          id: 'inst-2',
          loanId: 'loan-2',
          amount: 300,
          dueDate: daysAgo(31),
          status: InstallmentStatus.Pending,
        },
      ]);

      expect(await service.hasMoraBlock(mockClient.id)).toBe(true);
    });

    it('ignores an overdue installment on a refinanced-away (non-Active) loan', async () => {
      // The service only fetches loans with status: Active, so a refinanced
      // loan's old overdue installments never reach this point.
      loansRepository.find.mockResolvedValue([]);

      expect(await service.hasMoraBlock(mockClient.id)).toBe(false);
      expect(installmentsRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('findOneDetail', () => {
    it('includes creditUsed, creditAvailable, isMoraBlocked and references alongside the client fields', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockClient,
        creditLimit: 1000,
      });
      loansRepository.find.mockResolvedValue([
        { id: 'loan-1', clientId: mockClient.id },
      ]);
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'inst-1',
          loanId: 'loan-1',
          amount: 300,
          dueDate: daysAgo(35),
          status: InstallmentStatus.Pending,
        },
      ]);
      const mockReference: ClientReference = {
        id: 'reference-1',
        clientId: mockClient.id,
        client: {} as never,
        type: ClientReferenceType.Personal,
        fullName: 'Carlos Gómez',
        phoneNumber: '+573001112233',
        relationship: 'Hermano',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      clientReferencesRepository.find.mockResolvedValue([mockReference]);

      const result = await service.findOneDetail(mockClient.id);

      expect(result.id).toBe(mockClient.id);
      expect(result.creditAvailable).toBeLessThan(1000);
      expect(result.isMoraBlocked).toBe(true);
      expect(result.references).toEqual([mockReference]);
      expect(clientReferencesRepository.find).toHaveBeenCalledWith({
        where: { clientId: mockClient.id },
        order: { createdAt: 'ASC' },
      });
    });

    it('throws NotFoundException when the client does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.findOneDetail('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Phase 21 — a dynamic add/remove list, no fixed min/max. See
  // docs/phases/PHASE_21_CLIENT_PROFILE.md.
  describe('references', () => {
    const referenceDto = {
      type: ClientReferenceType.Personal,
      fullName: 'Carlos Gómez',
      phoneNumber: '+573001112233',
      relationship: 'Hermano',
    };
    const mockReference: ClientReference = {
      id: 'reference-1',
      clientId: mockClient.id,
      client: {} as never,
      ...referenceDto,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    describe('addReference', () => {
      it('adds a reference to an existing client', async () => {
        repository.findOneBy.mockResolvedValue(mockClient);
        clientReferencesRepository.save.mockResolvedValue(mockReference);

        const result = await service.addReference(mockClient.id, referenceDto);

        expect(result).toEqual(mockReference);
        expect(clientReferencesRepository.create).toHaveBeenCalledWith({
          ...referenceDto,
          clientId: mockClient.id,
        });
      });

      it('throws NotFoundException when the client does not exist', async () => {
        repository.findOneBy.mockResolvedValue(null);

        await expect(
          service.addReference('missing-id', referenceDto),
        ).rejects.toThrow(NotFoundException);
        expect(clientReferencesRepository.save).not.toHaveBeenCalled();
      });
    });

    describe('updateReference', () => {
      it('updates a reference that belongs to the given client', async () => {
        clientReferencesRepository.findOneBy.mockResolvedValue(mockReference);
        clientReferencesRepository.save.mockResolvedValue({
          ...mockReference,
          fullName: 'Carlos Andrés Gómez',
        });

        const result = await service.updateReference(
          mockClient.id,
          mockReference.id,
          { fullName: 'Carlos Andrés Gómez' },
        );

        expect(result.fullName).toBe('Carlos Andrés Gómez');
        expect(clientReferencesRepository.findOneBy).toHaveBeenCalledWith({
          id: mockReference.id,
          clientId: mockClient.id,
        });
      });

      it('throws NotFoundException when the reference does not exist for that client', async () => {
        clientReferencesRepository.findOneBy.mockResolvedValue(null);

        await expect(
          service.updateReference(mockClient.id, 'missing-reference', {
            fullName: 'X',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(clientReferencesRepository.save).not.toHaveBeenCalled();
      });
    });

    describe('removeReference', () => {
      it('removes a reference that belongs to the given client', async () => {
        clientReferencesRepository.findOneBy.mockResolvedValue(mockReference);

        await service.removeReference(mockClient.id, mockReference.id);

        expect(clientReferencesRepository.remove).toHaveBeenCalledWith(
          mockReference,
        );
      });

      it('throws NotFoundException when the reference does not exist for that client', async () => {
        clientReferencesRepository.findOneBy.mockResolvedValue(null);

        await expect(
          service.removeReference(mockClient.id, 'missing-reference'),
        ).rejects.toThrow(NotFoundException);
        expect(clientReferencesRepository.remove).not.toHaveBeenCalled();
      });
    });
  });

  // Phase 27 — throttles overdue/upcoming_due frequency, never eligibility.
  // See docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.
  describe('messageFrequency', () => {
    describe('getMessageFrequency', () => {
      it('returns null when the client has no whitelist entry', async () => {
        clientMessageFrequenciesRepository.findOneBy.mockResolvedValue(null);

        const result = await service.getMessageFrequency(mockClient.id);

        expect(result).toBeNull();
        expect(
          clientMessageFrequenciesRepository.findOneBy,
        ).toHaveBeenCalledWith({ clientId: mockClient.id });
      });

      it('returns the existing entry', async () => {
        const entry: ClientMessageFrequency = {
          id: 'freq-1',
          clientId: mockClient.id,
          client: {} as never,
          minimumDaysBetweenMessages: 7,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        clientMessageFrequenciesRepository.findOneBy.mockResolvedValue(entry);

        const result = await service.getMessageFrequency(mockClient.id);

        expect(result).toEqual(entry);
      });
    });

    describe('setMessageFrequency', () => {
      it('creates a new entry when the client has none', async () => {
        repository.findOneBy.mockResolvedValue(mockClient);
        clientMessageFrequenciesRepository.findOneBy.mockResolvedValue(null);
        clientMessageFrequenciesRepository.save.mockImplementation(
          (entry: Partial<ClientMessageFrequency>) =>
            Promise.resolve({ id: 'freq-1', ...entry }),
        );

        const result = await service.setMessageFrequency(mockClient.id, {
          minimumDaysBetweenMessages: 7,
        });

        expect(clientMessageFrequenciesRepository.create).toHaveBeenCalledWith({
          clientId: mockClient.id,
        });
        expect(result.minimumDaysBetweenMessages).toBe(7);
      });

      it('updates the existing entry in place instead of creating a duplicate', async () => {
        repository.findOneBy.mockResolvedValue(mockClient);
        const existing: ClientMessageFrequency = {
          id: 'freq-1',
          clientId: mockClient.id,
          client: {} as never,
          minimumDaysBetweenMessages: 7,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        clientMessageFrequenciesRepository.findOneBy.mockResolvedValue(
          existing,
        );
        clientMessageFrequenciesRepository.save.mockImplementation(
          (entry: Partial<ClientMessageFrequency>) => Promise.resolve(entry),
        );

        const result = await service.setMessageFrequency(mockClient.id, {
          minimumDaysBetweenMessages: 14,
        });

        expect(
          clientMessageFrequenciesRepository.create,
        ).not.toHaveBeenCalled();
        expect(clientMessageFrequenciesRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'freq-1',
            minimumDaysBetweenMessages: 14,
          }),
        );
        expect(result.minimumDaysBetweenMessages).toBe(14);
      });

      it('throws NotFoundException when the client does not exist', async () => {
        repository.findOneBy.mockResolvedValue(null);

        await expect(
          service.setMessageFrequency('missing-id', {
            minimumDaysBetweenMessages: 7,
          }),
        ).rejects.toThrow(NotFoundException);
        expect(clientMessageFrequenciesRepository.save).not.toHaveBeenCalled();
      });
    });

    describe('clearMessageFrequency', () => {
      it('deletes the entry for the given client', async () => {
        repository.findOneBy.mockResolvedValue(mockClient);

        await service.clearMessageFrequency(mockClient.id);

        expect(clientMessageFrequenciesRepository.delete).toHaveBeenCalledWith({
          clientId: mockClient.id,
        });
      });

      it('throws NotFoundException when the client does not exist', async () => {
        repository.findOneBy.mockResolvedValue(null);

        await expect(
          service.clearMessageFrequency('missing-id'),
        ).rejects.toThrow(NotFoundException);
        expect(
          clientMessageFrequenciesRepository.delete,
        ).not.toHaveBeenCalled();
      });
    });
  });

  describe('reactivate', () => {
    it('restores a soft-deleted client', async () => {
      const deletedClient = { ...mockClient, deletedAt: new Date() };
      repository.findOne.mockResolvedValue(deletedClient);
      repository.findOneBy.mockResolvedValue(mockClient);

      const result = await service.reactivate(mockClient.id);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: mockClient.id },
        withDeleted: true,
      });
      expect(repository.restore).toHaveBeenCalledWith({ id: mockClient.id });
      expect(result).toEqual(mockClient);
    });

    it('throws NotFoundException when the client does not exist at all', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.reactivate('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.restore).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the client is already active', async () => {
      repository.findOne.mockResolvedValue(mockClient);

      await expect(service.reactivate(mockClient.id)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.restore).not.toHaveBeenCalled();
    });
  });
});
