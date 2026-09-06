import ExcelJS from 'exceljs';

import {
  allColumnDefinitions,
  buildConceptColumnGroups,
  CLIENT_LOOKUP_COLUMNS,
  LOAN_COLUMNS,
} from './loanImportColumns';
import { RowError } from './loanImportParser';

// Human-friendly header labels, keyed by column key — separate from the
// alias list (which is lowercased/accent-stripped for matching) so the
// generated file reads naturally. Falls back to the first alias,
// title-cased, for anything not listed here explicitly.
const DISPLAY_HEADERS: Record<string, string> = {
  documentNumber: 'Cédula del cliente',
  promissoryNoteNumber: 'Pagaré',
  principalAmount: 'Monto del crédito',
  interestRate: 'Tasa moratoria (%)',
  disbursedAt: 'Fecha de desembolso',
  installmentFrequency: 'Frecuencia de pago (mensual/quincenal)',
  totalInstallments: 'Número de cuotas',
  description: 'Descripción del crédito',
};

// Per-column fill-in instructions/examples for row 2 — same convention
// (and same reasoning) as clientsImportTemplate.ts: ambiguous fields like
// dates cause avoidable row errors otherwise. Dates MUST be AAAA-MM-DD:
// validated downstream via class-validator's @IsDateString().
const FIELD_HINTS: Record<string, string> = {
  documentNumber:
    'Cédula de un cliente que YA existe en el sistema. Solo números, sin puntos ni espacios. Ej: 1234567890',
  promissoryNoteNumber: 'Ej: #743',
  principalAmount: 'Solo números, sin puntos de miles. Ej: 900000',
  interestRate: 'Solo el número, sin el símbolo %. Ej: 6',
  disbursedAt: 'Formato AAAA-MM-DD (año-mes-día). Ej: 2026-07-09',
  installmentFrequency: 'Escribe: mensual o quincenal',
  totalInstallments: 'Número entero de cuotas. Ej: 12',
  description: 'Ej: Compra de celular, televisor, computador…',
};

const CONCEPT_NAME_HINT =
  'Debe coincidir exactamente con un concepto activo en Conceptos de interés';
const CONCEPT_TYPE_HINT = 'Escribe: porcentaje o fijo';
const CONCEPT_VALUE_HINT = 'Solo números. Ej: 2.5';

function headerFor(key: string, fallbackAlias: string): string {
  return DISPLAY_HEADERS[key] ?? fallbackAlias;
}

function buildHeaders(): string[] {
  const headers = [
    ...CLIENT_LOOKUP_COLUMNS.map((c) => headerFor(c.key, c.aliases[0])),
    ...LOAN_COLUMNS.map((c) => headerFor(c.key, c.aliases[0])),
  ];
  for (const group of buildConceptColumnGroups()) {
    headers.push(
      `Cargo adicional #${group.index} - Nombre`,
      `Cargo adicional #${group.index} - Tipo (porcentaje/fijo)`,
      `Cargo adicional #${group.index} - Valor`,
    );
  }
  return headers;
}

function buildFieldHints(): string[] {
  const hints = [
    ...CLIENT_LOOKUP_COLUMNS.map((c) => FIELD_HINTS[c.key] ?? ''),
    ...LOAN_COLUMNS.map((c) => FIELD_HINTS[c.key] ?? ''),
  ];
  buildConceptColumnGroups().forEach(() => {
    hints.push(CONCEPT_NAME_HINT, CONCEPT_TYPE_HINT, CONCEPT_VALUE_HINT);
  });
  return hints;
}

// Row 2 is a fixed structural convention for every workbook this module
// generates (template and errors-export alike): per-column fill-in
// instructions/examples, always skipped by the parser regardless of what
// ends up written in it. Frozen alongside the header row so it stays
// visible while an admin scrolls through many data rows.
function addInstructionsRow(sheet: ExcelJS.Worksheet, hints: string[]): void {
  const row = sheet.addRow(hints);
  row.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  row.alignment = { wrapText: true, vertical: 'top' };
  row.height = 45;
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
}

// POST /loans/import-template — an empty workbook with exactly the
// columns the parser accepts, built from the same column definitions
// (loanImportColumns.ts) so the template and the parser can never drift
// apart. One row = one credit for an already-existing client, found by
// cédula — see LoanImportService for what happens when no client has
// that cédula on file.
export async function buildImportTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Créditos');

  const headers = buildHeaders();
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  addInstructionsRow(sheet, buildFieldHints());
  sheet.columns = headers.map(() => ({ width: 26 }));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Regenerates a workbook containing only the rows that failed a given
// import attempt, with their original values pre-filled plus a trailing
// "Motivo del error" column — so the admin can fix just what's wrong and
// re-upload through the exact same endpoint, instead of retyping
// everything from scratch. Stateless: the caller (frontend) already has
// this exact `RowError[]` from the import response.
export async function buildImportErrorsWorkbook(
  errors: RowError[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Filas con error');

  const columns = allColumnDefinitions();
  const headers = [...buildHeaders(), 'Motivo del error'];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  addInstructionsRow(sheet, [
    ...buildFieldHints(),
    'Corrige lo indicado y vuelve a subir el archivo',
  ]);
  sheet.columns = headers.map(() => ({ width: 26 }));

  for (const error of errors) {
    const values = columns.map((column) => error.rawValues[column.key] ?? '');
    sheet.addRow([...values, error.reason]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
