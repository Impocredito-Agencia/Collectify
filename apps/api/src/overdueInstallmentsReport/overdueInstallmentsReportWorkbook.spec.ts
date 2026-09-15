import ExcelJS from 'exceljs';

import { OverdueInstallmentDetail } from '../dashboard/dashboard.service';

import {
  buildOverdueInstallmentsReportWorkbook,
  overdueInstallmentsReportFilename,
} from './overdueInstallmentsReportWorkbook';

function makeRow(
  overrides: Partial<OverdueInstallmentDetail> = {},
): OverdueInstallmentDetail {
  return {
    clientId: 'client-1',
    clientFirstName: 'Juana',
    clientLastName: 'Pérez',
    clientDocumentNumber: '1234567890',
    clientPhoneNumber: '+573001234567',
    promissoryNoteNumber: '#0800',
    alternateContactPhoneNumber: null,
    installmentNumber: 3,
    dueDate: '2026-08-15',
    amount: 300000,
    interest: 45000,
    totalDue: 345000,
    overdueDays: 10,
    ...overrides,
  };
}

async function loadSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook.worksheets[0];
}

describe('buildOverdueInstallmentsReportWorkbook', () => {
  it('writes one data row per installment, below the summary line and the header', async () => {
    const buffer = await buildOverdueInstallmentsReportWorkbook([
      makeRow({ promissoryNoteNumber: '#0800' }),
    ]);
    const sheet = await loadSheet(buffer);

    expect(sheet.getRow(1).getCell(1).text).toContain('Cuotas vencidas');
    expect(sheet.getRow(3).getCell(1).text).toBe('Cliente');
    expect(sheet.getRow(4).getCell(1).text).toBe('Juana Pérez');
    expect(sheet.getRow(4).getCell(4).text).toBe('#0800');
    expect(sheet.rowCount).toBe(4);
  });

  // Confirmed with the human, 2026-09-15 — matches how this was tracked
  // manually before (by pagaré), not by urgency.
  it('sorts by promissory note number, numerically, not by overdue days', async () => {
    const buffer = await buildOverdueInstallmentsReportWorkbook([
      makeRow({
        promissoryNoteNumber: '#101',
        installmentNumber: 1,
        overdueDays: 5,
      }),
      makeRow({
        promissoryNoteNumber: '#2',
        installmentNumber: 1,
        overdueDays: 90,
      }),
    ]);
    const sheet = await loadSheet(buffer);

    expect(sheet.getRow(4).getCell(4).text).toBe('#2');
    expect(sheet.getRow(5).getCell(4).text).toBe('#101');
  });

  it('breaks a tie on the same pagaré by installment number', async () => {
    const buffer = await buildOverdueInstallmentsReportWorkbook([
      makeRow({ promissoryNoteNumber: '#500', installmentNumber: 3 }),
      makeRow({ promissoryNoteNumber: '#500', installmentNumber: 1 }),
    ]);
    const sheet = await loadSheet(buffer);

    expect(sheet.getRow(4).getCell(5).value).toBe(1);
    expect(sheet.getRow(5).getCell(5).value).toBe(3);
  });

  it('formats the money columns as currency, not plain numbers', async () => {
    const buffer = await buildOverdueInstallmentsReportWorkbook([makeRow()]);
    const sheet = await loadSheet(buffer);

    const row = sheet.getRow(4);
    expect(row.getCell(8).numFmt).toBe('"$"#,##0');
    expect(row.getCell(9).numFmt).toBe('"$"#,##0');
    expect(row.getCell(10).numFmt).toBe('"$"#,##0');
    expect(row.getCell(10).value).toBe(345000);
  });

  // Threshold matches the existing 30-day "mora block" rule elsewhere in
  // the app — not an arbitrary number picked just for this report.
  it('highlights a cuota 30+ days overdue, not one that is less overdue', async () => {
    const buffer = await buildOverdueInstallmentsReportWorkbook([
      makeRow({ overdueDays: 45, promissoryNoteNumber: '#1' }),
      makeRow({ overdueDays: 10, promissoryNoteNumber: '#2' }),
    ]);
    const sheet = await loadSheet(buffer);

    const severeRow = sheet.getRow(4);
    const normalRow = sheet.getRow(5);
    expect(severeRow.getCell(7).fill).toMatchObject({
      fgColor: { argb: 'FFFFC7CE' },
    });
    expect(normalRow.getCell(7).fill).toBeUndefined();
  });

  it('leaves the alternate contact column blank when the loan has none', async () => {
    const buffer = await buildOverdueInstallmentsReportWorkbook([
      makeRow({ alternateContactPhoneNumber: null }),
    ]);
    const sheet = await loadSheet(buffer);

    expect(sheet.getRow(4).getCell(11).value).toBe('');
  });
});

describe('overdueInstallmentsReportFilename', () => {
  it('matches cuotas_vencidas_YYYY-MM-DD.xlsx', () => {
    expect(overdueInstallmentsReportFilename()).toMatch(
      /^cuotas_vencidas_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
  });
});
