import ExcelJS from 'exceljs';

import { parseClientLoanWorkbook } from './clientLoanImportParser';

// Descripción del crédito became required 2026-09-04 (same CreateLoanDto
// change as the interactive "Nuevo préstamo" form — see
// clientLoanImportColumns.ts), so it's now part of the minimal valid row
// every test in this file builds from — appended at the end so none of
// the existing index-based row mutations below (row[1], row[4], row[8])
// shift.
const REQUIRED_HEADERS = [
  'Nombre',
  'Apellido',
  'Cédula',
  'Teléfono',
  'Pagaré',
  'Monto del crédito',
  'Tasa moratoria',
  'Fecha de desembolso',
  'Frecuencia de pago',
  'Número de cuotas',
  'Descripción del crédito',
];

const REQUIRED_ROW = [
  'Juana',
  'Pérez',
  '1234567890',
  '+573001234567',
  '#743',
  900000,
  6,
  '2026-08-01',
  'mensual',
  12,
  'Compra de televisor',
];

async function buildWorkbook(
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clientes y créditos');
  sheet.addRow(headers);
  // Row 2 is always the fill-in-instructions row in the real generated
  // template (clientLoanImportTemplate.ts) — parseClientLoanWorkbook skips
  // it unconditionally, so every fixture here reproduces that same
  // structural shape (data starts at row 3), even though its content
  // doesn't matter for these tests. See the dedicated test below for
  // proof that non-blank content in row 2 is still ignored.
  sheet.addRow(headers.map(() => ''));
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseClientLoanWorkbook', () => {
  it('parses a row with only the required client+loan columns', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [REQUIRED_ROW]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].client).toMatchObject({
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
    });
    expect(result.rows[0].loan).toMatchObject({
      promissoryNoteNumber: '#743',
      principalAmount: 900000,
      interestRate: 6,
      disbursedAt: '2026-08-01',
      installmentFrequency: 'monthly',
      totalInstallments: 12,
      description: 'Compra de televisor',
    });
    expect(result.rows[0].concepts).toEqual([]);
  });

  it('throws when a required column is missing', async () => {
    await expect(
      buildWorkbook(
        REQUIRED_HEADERS.filter((h) => h !== 'Pagaré'),
        [REQUIRED_ROW.filter((_, i) => i !== 4)],
      ).then(parseClientLoanWorkbook),
    ).rejects.toThrow(/missing required column/i);
  });

  it('skips fully blank rows without reporting an error', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [
      REQUIRED_ROW,
      REQUIRED_ROW.map(() => null),
    ]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a row error (with raw values preserved) when a required field is missing', async () => {
    const rowMissingLastName = [...REQUIRED_ROW];
    rowMissingLastName[1] = '';
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [rowMissingLastName]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/apellido/i);
    expect(result.errors[0].rawValues.firstName).toBe('Juana');
  });

  it('parses a "cargo adicional" group when its Nombre column is filled', async () => {
    const headers = [
      ...REQUIRED_HEADERS,
      'Cargo adicional #1 - Nombre',
      'Cargo adicional #1 - Tipo',
      'Cargo adicional #1 - Valor',
    ];
    const row = [...REQUIRED_ROW, 'Gastos de cobranza', 'porcentaje', 2.5];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].concepts).toEqual([
      { name: 'Gastos de cobranza', calculationType: 'percentage', value: 2.5 },
    ]);
  });

  it('ignores a "cargo adicional" group entirely when its Nombre is blank', async () => {
    const headers = [
      ...REQUIRED_HEADERS,
      'Cargo adicional #1 - Nombre',
      'Cargo adicional #1 - Tipo',
      'Cargo adicional #1 - Valor',
    ];
    // Nombre blank but Tipo/Valor stray-filled — should still be ignored.
    const row = [...REQUIRED_ROW, '', 'fijo', 5000];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].concepts).toEqual([]);
  });

  it('flags a row error when a "cargo adicional" group has a Nombre but an invalid Tipo', async () => {
    const headers = [
      ...REQUIRED_HEADERS,
      'Cargo adicional #1 - Nombre',
      'Cargo adicional #1 - Tipo',
      'Cargo adicional #1 - Valor',
    ];
    const row = [...REQUIRED_ROW, 'Interés', 'no-se-que-tipo', 2.5];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/tipo inválido/i);
  });

  it('accepts up to 4 "cargo adicional" groups on the same row', async () => {
    const groupHeaders = [1, 2, 3, 4].flatMap((n) => [
      `Cargo adicional #${n} - Nombre`,
      `Cargo adicional #${n} - Tipo`,
      `Cargo adicional #${n} - Valor`,
    ]);
    const groupValues = [1, 2, 3, 4].flatMap((n) => [
      `Concepto ${n}`,
      n % 2 === 0 ? 'fijo' : 'porcentaje',
      n * 1000,
    ]);
    const buffer = await buildWorkbook(
      [...REQUIRED_HEADERS, ...groupHeaders],
      [[...REQUIRED_ROW, ...groupValues]],
    );

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].concepts).toHaveLength(4);
  });

  it('normalizes "quincenal" to the biweekly enum value', async () => {
    const row = [...REQUIRED_ROW];
    row[8] = 'Quincenal';
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [row]);

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.rows[0].loan.installmentFrequency).toBe('biweekly');
  });

  it("ignores row 2 (reserved for the template's fill-in instructions) even when it has content", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Clientes y créditos');
    sheet.addRow(REQUIRED_HEADERS);
    sheet.addRow(REQUIRED_HEADERS.map(() => 'Ej: instrucción de ejemplo'));
    sheet.addRow(REQUIRED_ROW);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseClientLoanWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].client.firstName).toBe('Juana');
  });
});
