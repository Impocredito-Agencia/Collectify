import ExcelJS from 'exceljs';

import { parseLoansWorkbook } from './loanImportParser';

const REQUIRED_HEADERS = [
  'Cédula del cliente',
  'Pagaré',
  'Monto del crédito',
  'Tasa moratoria',
  'Fecha de desembolso',
  'Frecuencia de pago',
  'Número de cuotas',
  'Descripción del crédito',
];

const REQUIRED_ROW = [
  '1234567890',
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
  const sheet = workbook.addWorksheet('Créditos');
  sheet.addRow(headers);
  // Row 2 is always the fill-in-instructions row in the real generated
  // template (loanImportTemplate.ts) — parseLoansWorkbook skips it
  // unconditionally, so every fixture here reproduces that same
  // structural shape (data starts at row 3).
  sheet.addRow(headers.map(() => ''));
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseLoansWorkbook', () => {
  it('parses a row with only the required loan columns', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [REQUIRED_ROW]);

    const result = await parseLoansWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].documentNumber).toBe('1234567890');
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
        [REQUIRED_ROW.filter((_, i) => i !== 1)],
      ).then(parseLoansWorkbook),
    ).rejects.toThrow(/missing required column/i);
  });

  it('skips fully blank rows without reporting an error', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [
      REQUIRED_ROW,
      REQUIRED_ROW.map(() => null),
    ]);

    const result = await parseLoansWorkbook(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a row error (with raw values preserved) when a required field is missing', async () => {
    const rowMissingPromissoryNote = [...REQUIRED_ROW];
    rowMissingPromissoryNote[1] = '';
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [
      rowMissingPromissoryNote,
    ]);

    const result = await parseLoansWorkbook(buffer);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/pagar/i);
    expect(result.errors[0].rawValues.documentNumber).toBe('1234567890');
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

    const result = await parseLoansWorkbook(buffer);

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
    const row = [...REQUIRED_ROW, '', 'fijo', 5000];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseLoansWorkbook(buffer);

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

    const result = await parseLoansWorkbook(buffer);

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

    const result = await parseLoansWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].concepts).toHaveLength(4);
  });

  it('normalizes "quincenal" to the biweekly enum value', async () => {
    const row = [...REQUIRED_ROW];
    row[5] = 'Quincenal';
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [row]);

    const result = await parseLoansWorkbook(buffer);

    expect(result.rows[0].loan.installmentFrequency).toBe('biweekly');
  });

  it("ignores row 2 (reserved for the template's fill-in instructions) even when it has content", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Créditos');
    sheet.addRow(REQUIRED_HEADERS);
    sheet.addRow(REQUIRED_HEADERS.map(() => 'Ej: instrucción de ejemplo'));
    sheet.addRow(REQUIRED_ROW);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseLoansWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].documentNumber).toBe('1234567890');
  });
});
