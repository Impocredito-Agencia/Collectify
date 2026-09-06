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
  // Row 2 is always the fill-in-instructions row in the real generated
  // template (clientsImportTemplate.ts) — parseClientsWorkbook skips it
  // unconditionally, so every fixture here reproduces that same
  // structural shape (data starts at row 3), even though its content
  // doesn't matter for these tests.
  sheet.addRow(headers.map(() => ''));
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
    const headers = [...REQUIRED_HEADERS, 'Ciudad', 'Barrio'];
    const row = [...REQUIRED_ROW, 'Bogotá', 'Centro'];
    const buffer = await buildWorkbook(headers, [row]);

    const result = await parseClientsWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].client).toMatchObject({
      city: 'Bogotá',
      neighborhood: 'Centro',
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

  it("ignores row 2 (reserved for the template's fill-in instructions) even when it has content", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Clientes');
    sheet.addRow(REQUIRED_HEADERS);
    sheet.addRow(REQUIRED_HEADERS.map(() => 'Ej: instrucción de ejemplo'));
    sheet.addRow(REQUIRED_ROW);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseClientsWorkbook(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].client.firstName).toBe('Juana');
  });
});
