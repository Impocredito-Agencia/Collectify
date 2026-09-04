import ExcelJS from 'exceljs';

import {
  allColumnDefinitions,
  CLIENT_COLUMNS,
  LOAN_COLUMNS,
  buildConceptColumnGroups,
} from './clientLoanImportColumns';
import { RowError } from './clientLoanImportParser';

// Human-friendly header labels, keyed by column key — separate from the
// alias list (which is lowercased/accent-stripped for matching) so the
// generated file reads naturally. Falls back to the first alias,
// title-cased, for anything not listed here explicitly.
const DISPLAY_HEADERS: Record<string, string> = {
  firstName: 'Nombre',
  lastName: 'Apellido',
  documentNumber: 'Cédula',
  phoneNumber: 'Teléfono',
  creditLimit: 'Cupo',
  documentType: 'Tipo de documento',
  dateOfBirth: 'Fecha de nacimiento',
  documentIssuePlace: 'Lugar de expedición',
  documentIssueDate: 'Fecha de expedición',
  email: 'Correo',
  alternatePhoneNumber: 'Teléfono alterno',
  homeAddress: 'Dirección de residencia',
  workAddress: 'Dirección de trabajo',
  neighborhood: 'Barrio',
  city: 'Ciudad',
  occupation: 'Ocupación',
  employerName: 'Empresa',
  monthlyIncome: 'Ingresos mensuales',
  promissoryNoteNumber: 'Pagaré',
  principalAmount: 'Monto del crédito',
  interestRate: 'Tasa moratoria (%)',
  disbursedAt: 'Fecha de desembolso',
  installmentFrequency: 'Frecuencia de pago (mensual/quincenal)',
  totalInstallments: 'Número de cuotas',
  description: 'Descripción del crédito',
};

// Per-column fill-in instructions/examples for row 2 — added because the
// admin's own report (2026-08-19) was that ambiguous fields like phone
// numbers (+57 or not?) and dates (DD/MM/YYYY? MM/DD/YYYY? spelled out?)
// were causing avoidable row errors on upload. Dates in particular MUST be
// AAAA-MM-DD: validated downstream via class-validator's @IsDateString(),
// same as every other date field in this codebase, which only accepts
// ISO 8601 — "01/01/2026" or "primero de enero de 2026" will always fail,
// no amount of parser leniency changes that, so this is guidance, not
// auto-correction. Phone numbers, by contrast, already tolerate both
// forms (@IsPhoneNumber('CO') parses national or E.164 format), so the
// hint here documents what already works rather than a new constraint.
const FIELD_HINTS: Record<string, string> = {
  firstName: 'Ej: Juana',
  lastName: 'Ej: Pérez',
  documentNumber: 'Solo números, sin puntos ni espacios. Ej: 1234567890',
  phoneNumber: 'Con o sin +57, solo números. Ej: +573001234567 o 3001234567',
  creditLimit: 'Opcional. Solo números. Ej: 2000000',
  documentType:
    'Opcional. Escribe: cédula de ciudadanía, cédula de extranjería o pasaporte',
  dateOfBirth: 'Opcional. Formato AAAA-MM-DD (año-mes-día). Ej: 1998-04-12',
  documentIssuePlace: 'Opcional. Ej: Bogotá D.C.',
  documentIssueDate: 'Opcional. Formato AAAA-MM-DD. Ej: 2015-03-20',
  email: 'Opcional. Ej: juana.perez@example.com',
  alternatePhoneNumber: 'Opcional. Con o sin +57. Ej: +573009876543',
  // Phase 26 — no longer optional: at least one of the two is required
  // (enforced in ClientsService.create(), same rule as the interactive
  // "Nuevo cliente" form — not exempted for import). Neither column alone
  // is individually required, so this can't just drop the "Opcional."
  // marker the way documentNumber's hint above does; the pairing has to be
  // spelled out instead.
  homeAddress:
    'Obligatorio si no llenas "Dirección de trabajo". Ej: Cra 45 #12-30, Barrio Centro',
  workAddress:
    'Obligatorio si no llenas "Dirección de residencia". Ej: Av. Siempre Viva 742',
  neighborhood: 'Opcional. Ej: Centro',
  city: 'Opcional. Ej: Bogotá',
  occupation: 'Opcional. Ej: Comerciante',
  employerName: 'Opcional. Ej: Tienda La Esquina',
  monthlyIncome: 'Opcional. Solo números. Ej: 1500000',
  promissoryNoteNumber: 'Ej: #743',
  principalAmount: 'Solo números, sin puntos de miles. Ej: 900000',
  interestRate: 'Solo el número, sin el símbolo %. Ej: 6',
  disbursedAt: 'Formato AAAA-MM-DD (año-mes-día). Ej: 2026-07-09',
  installmentFrequency: 'Escribe: mensual o quincenal',
  totalInstallments: 'Número entero de cuotas. Ej: 12',
  // "Cuota inicial" (down payment) is deliberately not importable via
  // Excel, 2026-09-03 — the redesign requires both an amount AND its own
  // due date (it's a real installment now, not an informational figure),
  // which doesn't fit this bulk/historical-load flow. Set it manually
  // afterward if needed. See docs/GLOSSARY.md.
  description: 'Opcional. Ej: Compra de electrodoméstico',
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
    ...CLIENT_COLUMNS.map((c) => headerFor(c.key, c.aliases[0])),
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

// Mirrors buildHeaders() column-for-column — kept as a separate function
// (not folded into DISPLAY_HEADERS) since a header and its instructions
// are conceptually different things, even though they're written to
// adjacent rows.
function buildFieldHints(): string[] {
  const hints = [
    ...CLIENT_COLUMNS.map((c) => FIELD_HINTS[c.key] ?? ''),
    ...LOAN_COLUMNS.map((c) => FIELD_HINTS[c.key] ?? ''),
  ];
  // One fixed hint set per group — the wording doesn't depend on the
  // group's index, only how many groups exist.
  buildConceptColumnGroups().forEach(() => {
    hints.push(CONCEPT_NAME_HINT, CONCEPT_TYPE_HINT, CONCEPT_VALUE_HINT);
  });
  return hints;
}

// Row 2 is a fixed structural convention for every workbook this module
// generates (template and errors-export alike): per-column fill-in
// instructions/examples, always skipped by the parser regardless of what
// ends up written in it (see the row-skip in clientLoanImportParser.ts).
// Frozen alongside the header row so it stays visible while an admin
// scrolls through many data rows — that's the whole point of it existing.
function addInstructionsRow(sheet: ExcelJS.Worksheet, hints: string[]): void {
  const row = sheet.addRow(hints);
  row.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  row.alignment = { wrapText: true, vertical: 'top' };
  row.height = 45;
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
}

// GET /clients/import-template — an empty workbook with exactly the
// columns the parser accepts, built from the same column definitions
// (clientLoanImportColumns.ts) so the template and the parser can never
// drift apart. One row = one credit — a client with several loans
// appears on several rows with the same cédula, see
// ClientLoanImportService for how repeats are reconciled.
export async function buildImportTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clientes y créditos');

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
// this exact `RowError[]` from the import response, nothing is persisted
// server-side between the import attempt and this call. Keeps the same
// row-1-header/row-2-instructions shape as the template, both because the
// admin is fixing the exact same kind of format mistakes this file is
// full of, and because the parser expects data to start at row 3 no
// matter which of these two endpoints produced the file being re-uploaded.
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
