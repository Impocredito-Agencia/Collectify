import ExcelJS from 'exceljs';

import { OverdueInstallmentDetail } from '../dashboard/dashboard.service';
import { todayDateString } from '../loans/dueDateSchedule';
import { comparePromissoryNoteNumbers } from '../loans/promissoryNoteNumberSort';

const CURRENCY_FORMAT = '"$"#,##0';
// Confirmed with the human, 2026-09-15 — reuses the existing "mora block"
// threshold (docs/GLOSSARY.md "Cupo (credit limit)" — a client this
// overdue on any one cuota can't get a new loan either) rather than
// picking an unrelated number just for this report's highlight.
const SEVERE_OVERDUE_DAYS_THRESHOLD = 30;
const SEVERE_OVERDUE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFC7CE' },
};
const SEVERE_OVERDUE_FONT: Partial<ExcelJS.Font> = {
  color: { argb: 'FF9C0006' },
};

const HEADERS = [
  'Cliente',
  'Documento',
  'Teléfono',
  'Pagaré',
  'Pagarés vencidos',
  'Cuota #',
  'Fecha de vencimiento',
  'Días de atraso',
  'Valor cuota',
  'Mora acumulada',
  'Total a pagar hoy',
  'Contacto alterno',
];
const COLUMN_WIDTHS = [26, 16, 16, 12, 17, 9, 20, 14, 14, 16, 16, 16];
// 1-based column index of each currency column, for numFmt below.
const CURRENCY_COLUMNS = [9, 10, 11];
const OVERDUE_DAYS_COLUMN = 8;

// One row per client: their oldest overdue cuota, plus how many of their
// pagarés have something overdue.
interface ClientReportRow extends OverdueInstallmentDetail {
  overduePromissoryNoteCount: number;
}

// "2024-01-15" -> "15/01/2024" — plain string manipulation, deliberately
// not parsed into a JS Date: this codebase has already hit (and fixed)
// several UTC-vs-Bogotá bugs from doing exactly that with a due date, see
// docs/DATABASE.md's dueDateSchedule.ts notes.
function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split('-');
  return `${day}/${month}/${year}`;
}

// Client request, 2026-10-23 — the sheet listed every overdue cuota of
// every pagaré, so a client behind on several pagarés filled many rows.
// Now each client gets ONE row: the cuota that has been overdue the
// longest (ties: lower pagaré number, then lower cuota number). The admin
// looks the client up in the panel to review the rest of their pagarés.
function keepOldestPerClient(
  rows: OverdueInstallmentDetail[],
): ClientReportRow[] {
  const byClient = new Map<string, OverdueInstallmentDetail[]>();
  for (const row of rows) {
    byClient.set(row.clientId, [...(byClient.get(row.clientId) ?? []), row]);
  }

  return Array.from(byClient.values()).map((clientRows) => {
    const [oldest] = [...clientRows].sort(
      (a, b) =>
        b.overdueDays - a.overdueDays ||
        comparePromissoryNoteNumbers(
          a.promissoryNoteNumber,
          b.promissoryNoteNumber,
        ) ||
        a.installmentNumber - b.installmentNumber,
    );
    return {
      ...oldest,
      overduePromissoryNoteCount: new Set(
        clientRows.map((row) => row.promissoryNoteNumber),
      ).size,
    };
  });
}

function sortForReport(rows: ClientReportRow[]): ClientReportRow[] {
  // Matches how the client filed this manually before — by pagaré, same
  // numeric-aware order as the "Préstamos" list (confirmed with the
  // human: familiarity matters more here than surfacing the most urgent
  // cuota first; the sheet's own filter lets anyone re-sort by "Días de
  // atraso" in one click if they want that instead). Installment number
  // is the tiebreaker so more than one overdue cuota on the same pagaré
  // reads top-to-bottom in payment order, not arbitrarily.
  return [...rows].sort((a, b) => {
    const byPromissoryNoteNumber = comparePromissoryNoteNumbers(
      a.promissoryNoteNumber,
      b.promissoryNoteNumber,
    );
    return byPromissoryNoteNumber !== 0
      ? byPromissoryNoteNumber
      : a.installmentNumber - b.installmentNumber;
  });
}

// Bogotá-aware "today" (see dueDateSchedule.ts's own comment) — not raw
// `new Date().toISOString()`, which is a day ahead of Bogotá's calendar
// date for roughly 5 hours every evening.
export function overdueInstallmentsReportFilename(): string {
  return `cuotas_vencidas_${todayDateString()}.xlsx`;
}

// GET /clients/reports/overdue-installments — one row per client with
// overdue cuotas (their oldest one, see keepOldestPerClient), built for a non-technical
// reader (confirmed with the human): a plain-language summary line up
// top, currency columns formatted as real numbers (not text), the most
// severely overdue rows flagged in red, and the header frozen so it stays
// visible while scrolling a long list.
export async function buildOverdueInstallmentsReportWorkbook(
  rows: OverdueInstallmentDetail[],
): Promise<Buffer> {
  const sorted = sortForReport(keepOldestPerClient(rows));
  // Every overdue cuota still counts toward the total, not just the one
  // row shown per client — the summary line reports the real amount owed.
  const totalOverdueAmount = rows.reduce((sum, row) => sum + row.totalDue, 0);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Cuotas vencidas');

  const generatedAt = formatDueDate(todayDateString());
  sheet.addRow([
    `Cuotas vencidas — generado el ${generatedAt} — ${sorted.length} cliente(s) con ${rows.length} cuota(s) vencida(s) por un total de $${totalOverdueAmount.toLocaleString('es-CO')}. Se muestra la cuota vencida más antigua de cada cliente; revise sus demás pagarés en el programa.`,
  ]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(HEADERS);
  headerRow.font = { bold: true };
  // Frozen through the header row (not just row 1) — the summary line
  // stays visible too while scrolling a long list, not just the columns.
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  for (const row of sorted) {
    const excelRow = sheet.addRow([
      `${row.clientFirstName} ${row.clientLastName}`,
      row.clientDocumentNumber,
      row.clientPhoneNumber,
      row.promissoryNoteNumber,
      row.overduePromissoryNoteCount,
      row.installmentNumber,
      formatDueDate(row.dueDate),
      row.overdueDays,
      row.amount,
      row.interest,
      row.totalDue,
      row.alternateContactPhoneNumber ?? '',
    ]);

    for (const columnIndex of CURRENCY_COLUMNS) {
      excelRow.getCell(columnIndex).numFmt = CURRENCY_FORMAT;
    }

    if (row.overdueDays >= SEVERE_OVERDUE_DAYS_THRESHOLD) {
      const cell = excelRow.getCell(OVERDUE_DAYS_COLUMN);
      cell.fill = SEVERE_OVERDUE_FILL;
      cell.font = SEVERE_OVERDUE_FONT;
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
