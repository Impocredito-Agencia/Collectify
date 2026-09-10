import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { InstallmentFrequency } from '../entities/loan.entity';

import { CreateLoanDto } from './createLoan.dto';

// Style cleanup (2026-09-03) — the only new decorator on this DTO is
// promissoryNoteNumber's @Matches(/^#\d{4,}$/); no other DTO in this
// project has its own spec file (validation is otherwise exercised
// indirectly through the service specs), but this regex is specific
// enough — and reused verbatim on the client in
// apps/client/src/features/loans/loansApi.ts's PROMISSORY_NOTE_NUMBER_PATTERN
// — to be worth pinning down directly. See docs/GLOSSARY.md "Loan / Pagaré".
describe('CreateLoanDto promissoryNoteNumber format', () => {
  const basePayload = {
    // Must be a real RFC-4122 UUID, not just a UUID-shaped placeholder —
    // '...-1111-1111-...' fails @IsUUID() on the variant nibble (needs
    // 8/9/a/b, not 1), so `validate()` was returning a clientId error
    // alongside whatever promissoryNoteNumber produced, and every "accepts"
    // case below failed toHaveLength(0) regardless of the format under
    // test. Same v4/variant-8 placeholder already used in
    // clientLoanImport.service.spec.ts.
    clientId: '11111111-1111-4111-8111-111111111111',
    principalAmount: 900000,
    disbursedAt: '2026-07-09',
    installmentFrequency: InstallmentFrequency.Monthly,
    totalInstallments: 12,
    concepts: [],
    description: 'Compra de televisor',
  };

  async function errorsFor(promissoryNoteNumber: string) {
    const dto = plainToInstance(CreateLoanDto, {
      ...basePayload,
      promissoryNoteNumber,
    });
    return validate(dto);
  }

  it.each(['#0001', '#1191', '#9999', '#10000'])(
    'accepts %s',
    async (value) => {
      const errors = await errorsFor(value);
      expect(errors).toHaveLength(0);
    },
  );

  it.each([
    ['missing the # prefix', '1191'],
    ['fewer than 4 digits', '#7'],
    ['non-numeric after the #', '#abcd'],
    ['empty string', ''],
  ])('rejects %s (%s)', async (_label, value) => {
    const errors = await errorsFor(value);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// Made required 2026-09-04 (client request) — this is the product the
// client acquired with the loan, sent verbatim as the "Detalle del
// producto" placeholder in the automatic "new loan" WhatsApp message
// (newLoanTemplateSelection.ts). Previously optional with a
// "No especificado" fallback when blank.
describe('CreateLoanDto description requiredness', () => {
  const basePayload = {
    clientId: '11111111-1111-4111-8111-111111111111',
    promissoryNoteNumber: '#0001',
    principalAmount: 900000,
    disbursedAt: '2026-07-09',
    installmentFrequency: InstallmentFrequency.Monthly,
    totalInstallments: 12,
    concepts: [],
  };

  it('accepts a non-empty description', async () => {
    const dto = plainToInstance(CreateLoanDto, {
      ...basePayload,
      description: 'Compra de celular',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  // @IsNotEmpty() only rejects '' / null / undefined, not a whitespace-only
  // string — same gap as every other @IsString() @IsNotEmpty() field in
  // this codebase (e.g. CreateClientDto.firstName), not something
  // introduced here.
  it.each([
    ['missing entirely', undefined],
    ['empty string', ''],
  ])('rejects description %s', async (_label, description) => {
    const dto = plainToInstance(CreateLoanDto, {
      ...basePayload,
      description,
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'description')).toBe(true);
  });
});
