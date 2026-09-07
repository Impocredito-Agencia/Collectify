import ExcelJS from 'exceljs';

import { parseClientsWorkbook } from './clientsImportParser';

const REQUIRED_HEADERS = ['Nombre', 'Apellido', 'Cédula', 'Teléfono'];

const REQUIRED_ROW = ['Juana', 'Pérez', '1234567890', '+573001234567'];

async function buildWorkbook(
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clientes');
  sheet.addRow(headers);
  // Row 1 = headers, row 2 onward = real data — matches the real generated
  // template (clientsImportTemplate.ts), which no longer has a fill-in-
  // instructions row between the two (removed 2026-09-06).
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseClientsWorkbook', () => {
  it('parses a row with only the required client columns', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [REQUIRED_ROW]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].client).toMatchObject({
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
    });
  });

  it('parses optional client columns when present', async () => {
    const headers = [...REQUIRED_HEADERS, 'Ciudad', 'Ocupación'];
    const row = [...REQUIRED_ROW, 'Bogotá', 'Comerciante'];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].client).toMatchObject({
      city: 'Bogotá',
      occupation: 'Comerciante',
    });
  });

  it('throws when a required column is missing', async () => {
    await expect(
      buildWorkbook(
        REQUIRED_HEADERS.filter((h) => h !== 'Cédula'),
        [REQUIRED_ROW.filter((_, i) => i !== 2)],
      ).then(parseClientsWorkbook),
    ).rejects.toThrow(/missing required column/i);
  });

  it('skips fully blank rows without reporting an error', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [
      REQUIRED_ROW,
      REQUIRED_ROW.map(() => null),
    ]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a row error (with raw values preserved) when a required field is missing', async () => {
    const rowMissingLastName = [...REQUIRED_ROW];
    rowMissingLastName[1] = '';
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [rowMissingLastName]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/apellido/i);
    expect(result.errors[0].rawValues.firstName).toBe('Juana');
  });

  // Regression test — clientsImportTemplate.ts's headerFor() appends a
  // "(O)"/"(O una de las dos)" marker to a required column's header text
  // (2026-09-06). The real generated template's headers must still match
  // their own column definitions, or every column looks missing.
  it('matches headers carrying the "(O)" required-column marker', async () => {
    const headers = [
      'Nombre (O)',
      'Apellido (O)',
      'Cédula (O)',
      'Teléfono (O)',
      'Dirección de residencia (O una de las dos)',
    ];
    const row = [...REQUIRED_ROW, 'Cra 1 #2-3'];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].client).toMatchObject({
      firstName: 'Juana',
      lastName: 'Pérez',
      documentNumber: '1234567890',
      phoneNumber: '+573001234567',
      homeAddress: 'Cra 1 #2-3',
    });
  });

  it('parses a second data row immediately after the header row, with no gap', async () => {
    const secondRow = ['Carlos', 'Gómez', '9876543210', '+573009876543'];
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [
      REQUIRED_ROW,
      secondRow,
    ]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.client.firstName)).toEqual([
      'Juana',
      'Carlos',
    ]);
  });
});
