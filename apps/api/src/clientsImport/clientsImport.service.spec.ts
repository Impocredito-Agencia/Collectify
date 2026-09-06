import { Test, TestingModule } from '@nestjs/testing';

import { ClientsService } from '../clients/clients.service';
import { Client } from '../clients/entities/client.entity';

import { ClientsImportService } from './clientsImport.service';
import { parseClientsWorkbook } from './clientsImportParser';

jest.mock('./clientsImportParser');

const mockParse = parseClientsWorkbook as jest.Mock;

function buildRow(overrides: {
  row?: number;
  client?: Record<string, string | number>;
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
    rawValues: {
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
      ...overrides.client,
    } as unknown as Record<string, string>,
  };
}

describe('ClientsImportService', () => {
  let service: ClientsImportService;
  let clientsService: { findByDocumentNumber: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    clientsService = {
      findByDocumentNumber: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsImportService,
        { provide: ClientsService, useValue: clientsService },
      ],
    }).compile();

    service = module.get(ClientsImportService);
    jest.clearAllMocks();
    clientsService.findByDocumentNumber.mockResolvedValue(null);
  });

  it('creates a new client for a valid row', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    clientsService.create.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
    });

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result).toEqual({
      totalRows: 1,
      created: 1,
      alreadyExisted: 0,
      skipped: [],
    });
    expect(clientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentNumber: '1234567890' }),
      { requireConsent: false, requireDocumentType: false },
    );
  });

  it('skips a row (without aborting the import) when ClientsService.create rejects it, e.g. no address', async () => {
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });
    clientsService.create.mockRejectedValue(
      new Error(
        'Debe registrar al menos una dirección (de residencia o de trabajo).',
      ),
    );

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result.created).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/al menos una dirección/i);
  });

  it('counts a repeated cédula with matching data as already-existed, not created', async () => {
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      firstName: 'Juana',
      lastName: 'Pérez',
      phoneNumber: '+573001234567',
    } as Client;
    clientsService.findByDocumentNumber.mockResolvedValue(existing);
    mockParse.mockResolvedValue({ rows: [buildRow({})], errors: [] });

    const result = await service.importFromExcel(Buffer.from(''));

    expect(clientsService.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.alreadyExisted).toBe(1);
    expect(result.skipped).toEqual([]);
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
    expect(result.created).toBe(0);
    expect(result.alreadyExisted).toBe(0);
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

    const result = await service.importFromExcel(Buffer.from(''));

    expect(result.alreadyExisted).toBe(1);
    expect(result.skipped).toEqual([]);
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
      alreadyExisted: 0,
      skipped: [{ row: 3, reason: 'Falta valor para: Cédula', rawValues: {} }],
    });
  });
});
