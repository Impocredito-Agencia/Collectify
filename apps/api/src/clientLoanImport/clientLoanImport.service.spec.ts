import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientsService } from '../clients/clients.service';
import { Client } from '../clients/entities/client.entity';
import {
  ConceptCalculationType,
  ConceptCategory,
  InterestConceptType,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { LoansService } from '../loans/loans.service';

import { ClientLoanImportService } from './clientLoanImport.service';
import { parseClientLoanWorkbook } from './clientLoanImportParser';

jest.mock('./clientLoanImportParser');

const mockParse = parseClientLoanWorkbook as jest.Mock;

// promissoryNoteNumber needs a real CreateLoanDto#0000-format value — Phase
// 231 added a validator requiring exactly 4 digits after "#", and this
// fixture (a stray 3-digit '#743') was never updated to match, so every
// test in this file was failing loanDto validation before it ever reached
// the behavior each test actually means to exercise.
// description became required 2026-09-04 (same CreateLoanDto change as the
// interactive "Nuevo préstamo" form) — added here for the same reason the
// comment above added #0743: every test in this file builds its loan
// through the real CreateLoanDto/validate(), so a fixture missing a
// now-required field fails before the behavior under test ever runs.
const REQUIRED_LOAN_FIELDS = {
  promissoryNoteNumber: '#0743',
  principalAmount: 900000,
  interestRate: 6,
  disbursedAt: '2026-08-01',
  installmentFrequency: 'monthly',
  totalInstallments: 12,
  description: 'Compra de televisor',
};

function buildRow(overrides: {
  row?: number;
  client?: Record<string, string | number>;
  loan?: Record<string, string | number>;
  concepts?: { name: string; calculationType: string; value: number }[];
}) {
  return {
    row: overrides.row ?? 2,
    client: {
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
      ...overrides.client,
    },
    loan: { ...REQUIRED_LOAN_FIELDS, ...overrides.loan },
    concepts: overrides.concepts ?? [],
    rawValues: {
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      ...REQUIRED_LOAN_FIELDS,
    } as unknown as Record<string, string>,
  };
}

describe('ClientLoanImportService', () => {
  let service: ClientLoanImportService;
  let clientsService: { findByDocumentNumber: jest.Mock; create: jest.Mock };
  let loansService: { create: jest.Mock };
  let clientsRepository: { delete: jest.Mock };
  let interestConceptTypesRepository: { find: jest.Mock };

  const mockActiveConcept: InterestConceptType = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Gastos de cobranza',
    defaultCalculationType: ConceptCalculationType.Percentage,
    defaultValue: null,
    category: ConceptCategory.Corriente,
    fixedAmountDistribution: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    clientsService = {
      findByDocumentNumber: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    loansService = { create: jest.fn() };
    clientsRepository = { delete: jest.fn() };
    interestConceptTypesRepository = {
      find: jest.fn().mockResolvedValue([mockActiveConcept]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientLoanImportService,
        { provide: ClientsService, useValue: clientsService },
        { provide: LoansService, useValue: loansService },
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        {
          provide: getRepositoryToken(InterestConceptType),
          useValue: interestConceptTypesRepository,
        },
      ],
    }).compile();

    service = module.get(ClientLoanImportService);
    jest.clearAllMocks();
    clientsService.findByDocumentNumber.mockResolvedValue(null);
    interestConceptTypesRepository.find.mockResolvedValue([mockActiveConcept]);
  });

  it('creates a new client and its loan for a valid row', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    clientsService.create.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
    });
    loansService.create.mockResolvedValue({});

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result).toEqual({ totalRows: 1, created: 1, skipped: [] });
    expect(clientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentNumber: '1234567890' }),
      { requireConsent: false, requireDocumentType: false },
    );
    expect(loansService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: '11111111-1111-4111-8111-111111111111',
      }),
    );
  });

  // Phase 26 — ClientsService.create() now unconditionally rejects a
  // client with no address at all (see clients.service.spec.ts), even for
  // this bulk-import caller. Confirms that rejection surfaces as a normal
  // skipped row here (via the existing generic try/catch around
  // clientsService.create()), not an aborted import — same "one bad row
  // doesn't sink the rest" contract as every other row-level failure.
  it('skips a row (without aborting the import) when ClientsService.create rejects it, e.g. no address', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    clientsService.create.mockRejectedValue(
      new Error(
        'Debe registrar al menos una dirección (de residencia o de trabajo).',
      ),
    );

    const result = await service.importFromExcel(Buffer.from(''));

    expect(loansService.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/al menos una dirección/i);
  });

  it('reuses an existing client (matching fields) instead of creating a duplicate', async () => {
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Juana',
      lastName: 'Pérez',
      phoneNumber: '+573001234567',
    } as Client;
    clientsService.findByDocumentNumber.mockResolvedValue(existing);
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    loansService.create.mockResolvedValue({});

    const result = await service.importFromExcel(Buffer.from(''));

    expect(clientsService.create).not.toHaveBeenCalled();
    // Single argument only — "modo histórico" (which used to pass a second
    // { skipCreditCheck: true } options object here) was removed
    // 2026-09-03 (see the comment on the real call site in
    // clientLoanImport.service.ts); this assertion's trailing
    // expect.anything() was a leftover from before that removal and was
    // masked by an unrelated pre-existing failure until now.
    expect(loansService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(result.created).toBe(1);
  });

  it('flags a row as an error, without creating anything, when a repeated cédula has conflicting data', async () => {
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Juana',
      lastName: 'Gómez', // different last name on file
      phoneNumber: '+573001234567',
    } as Client;
    clientsService.findByDocumentNumber.mockResolvedValue(existing);
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });

    const result = await service.importFromExcel(Buffer.from(''));

    expect(clientsService.create).not.toHaveBeenCalled();
    expect(loansService.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/ya existe con datos distintos/i);
  });

  it('does not treat a blank optional field on a repeat row as a conflict', async () => {
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Juana',
      lastName: 'Pérez',
      phoneNumber: '+573001234567',
      city: 'Bogotá',
    } as Client;
    clientsService.findByDocumentNumber.mockResolvedValue(existing);
    // This row doesn't repeat the city — should NOT be treated as "city was cleared."
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    loansService.create.mockResolvedValue({});

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it('fails the row when a "cargo adicional" name has no matching active catalog entry', async () => {
    mockParse.mockResolvedValue({
      rows: [
        buildRow({
          concepts: [
            {
              name: 'Concepto inexistente',
              calculationType: 'percentage',
              value: 2,
            },
          ],
        }),
      ],
      errors: [],
    });

    const result = await service.importFromExcel(Buffer.from(''));

    expect(clientsService.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped[0].reason).toMatch(/no existe en el catálogo/i);
  });

  it('rolls back a newly-created client when the loan fails afterward (all-or-nothing per row)', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    clientsService.create.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
    });
    loansService.create.mockRejectedValue(
      new Error("This loan's principal exceeds the client's available cupo."),
    );

    const result = await service.importFromExcel(Buffer.from(''));

    expect(clientsRepository.delete).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/cupo/i);
  });

  it('does not roll back a pre-existing (reused) client when its loan fails', async () => {
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Juana',
      lastName: 'Pérez',
      phoneNumber: '+573001234567',
    } as Client;
    clientsService.findByDocumentNumber.mockResolvedValue(existing);
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    loansService.create.mockRejectedValue(
      new Error('duplicate promissory note'),
    );

    const result = await service.importFromExcel(Buffer.from(''));

    expect(clientsRepository.delete).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('carries parser-level row errors straight through to the result', async () => {
    mockParse.mockResolvedValue({
      rows: [],
      errors: [{ row: 3, reason: 'Falta valor para: Cédula', rawValues: {} }],
    });

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result).toEqual({
      totalRows: 1,
      created: 0,
      skipped: [{ row: 3, reason: 'Falta valor para: Cédula', rawValues: {} }],
    });
  });
});
