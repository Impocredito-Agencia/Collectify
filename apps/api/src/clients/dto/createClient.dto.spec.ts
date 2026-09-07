import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateClientDto } from './createClient.dto';

// Confirms the @Transform(normalizePhoneNumber) fix (2026-09-06) actually
// fires through plainToInstance() — the exact call ClientsImportService
// makes for every Excel-imported row (see clientsImport.service.ts). This
// is what previously let Excel-imported clients end up with a raw,
// un-normalized phoneNumber ("3218204455") while manually-created clients
// were normalized/gated by the frontend into E.164 ("+573001234567").
describe('CreateClientDto phone normalization', () => {
  const baseInput = {
    firstName: 'Juana',
    lastName: 'Pérez',
    documentNumber: '1234567890',
    homeAddress: 'Cra 1 #2-3',
  };

  it('normalizes a bare local-format phoneNumber to E.164', async () => {
    const dto = plainToInstance(CreateClientDto, {
      ...baseInput,
      phoneNumber: '3218204455',
    });

    expect(dto.phoneNumber).toBe('+573218204455');

    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });

  it('normalizes a phoneNumber typed with spaces to E.164', () => {
    const dto = plainToInstance(CreateClientDto, {
      ...baseInput,
      phoneNumber: '+57 321 940 2299',
    });

    expect(dto.phoneNumber).toBe('+573219402299');
  });

  it('leaves an already-E.164 phoneNumber unchanged', () => {
    const dto = plainToInstance(CreateClientDto, {
      ...baseInput,
      phoneNumber: '+573001234567',
    });

    expect(dto.phoneNumber).toBe('+573001234567');
  });

  it('also normalizes alternatePhoneNumber', () => {
    const dto = plainToInstance(CreateClientDto, {
      ...baseInput,
      phoneNumber: '+573001234567',
      alternatePhoneNumber: '321-940-2299',
    });

    expect(dto.alternatePhoneNumber).toBe('+573219402299');
  });

  it('still rejects an invalid phoneNumber instead of silently passing it through', async () => {
    const dto = plainToInstance(CreateClientDto, {
      ...baseInput,
      phoneNumber: 'not-a-phone-number',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'phoneNumber')).toBe(true);
  });
});
