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

import { LoanImportService } from './loanImport.service';
import { parseLoansWorkbook } from './loanImportParser';

jest.mock('./loanImportParser');

const mockParse = parseLoansWorkbook as jest.Mock;

// promissoryNoteNumber needs a real CreateLoanDto#0000-format value —
// every test in this file builds its loan through the real
// CreateLoanDto/validate(), so a fixture missing a required field fails
// before the behavior under test ever runs.
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
  documentNumber?: string;
  loan?: Record<string, string | number>;
  concepts?: { name: string; calculationType: string; value: number }[];
}) {
  return {
    row: overrides.row ?? 2,
    documentNumber: overrides.documentNumber ?? '1234567890',
    loan: { ...REQUIRED_LOAN_FIELDS, ...overrides.loan },
    concepts: overrides.concepts ?? [],
    rawValues: {
      documentNumber: overrides.documentNumber ?? '1234567890',
      ...REQUIRED_LOAN_FIELDS,
    } as unknown as Record<string, string>,
  };
}

describe('LoanImportService', () => {
  let service: LoanImportService;
  let clientsService: { findByDocumentNumber: jest.Mock };
  let loansService: { create: jest.Mock };
  let interestConceptTypesRepository: { find: jest.Mock };

  const mockClient = { id: '11111111-1111-4111-8111-111111111111' } as Client;
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
      findByDocumentNumber: jest.fn().mockResolvedValue(mockClient),
    };
    loansService = { create: jest.fn() };
    interestConceptTypesRepository = {
      find: jest.fn().mockResolvedValue([mockActiveConcept]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanImportService,
        { provide: ClientsService, useValue: clientsService },
        { provide: LoansService, useValue: loansService },
        {
          provide: getRepositoryToken(InterestConceptType),
          useValue: interestConceptTypesRepository,
        },
      ],
    }).compile();

    service = module.get(LoanImportService);
    jest.clearAllMocks();
    clientsService.findByDocumentNumber.mockResolvedValue(mockClient);
    interestConceptTypesRepository.find.mockResolvedValue([mockActiveConcept]);
  });

  it('creates a loan for an existing client found by cédula', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    loansService.create.mockResolvedValue({});

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result).toEqual({ totalRows: 1, created: 1, skipped: [] });
    expect(clientsService.findByDocumentNumber).toHaveBeenCalledWith(
      '1234567890',
    );
    expect(loansService.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: mockClient.id }),
    );
  });

  it('skips the row (without aborting the import) when no client has that cédula', async () => {
    clientsService.findByDocumentNumber.mockResolvedValue(null);
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });

    const result = await service.importFromExcel(Buffer.from(''));

    expect(loansService.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/no existe un cliente/i);
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

    expect(loansService.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped[0].reason).toMatch(/no existe en el catálogo/i);
  });

  it('skips the row (without touching the client) when LoansService.create rejects it', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    loansService.create.mockRejectedValue(
      new Error("This loan's principal exceeds the client's available cupo."),
    );

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/cupo/i);
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
