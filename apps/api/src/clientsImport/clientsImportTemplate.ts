import ExcelJS from 'exceljs';

import {
  allColumnDefinitions,
  CLIENT_COLUMNS,
  ColumnDefinition,
} from './clientsImportColumns';
import { RowError } from './clientsImportParser';

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
  city: 'Ciudad',
  occupation: 'Ocupación',
  employerName: 'Empresa',
  monthlyIncome: 'Ingresos mensuales',
};

// Suffix appended to a column's header to mark it required, in place of
// the fill-in-instructions row this module used to generate (removed
// 2026-09-06, human request — the template now has nothing but the
// header row, no example/instructions row underneath it). homeAddress and
// workAddress are a special case: ClientsService.create() requires at
// least one of the two, never both individually, so a plain "(O)" on
// either would overstate the rule — see REQUIRED_SUFFIX below.
const REQUIRED_SUFFIX = ' (O)';
const ADDRESS_PAIR_SUFFIX = ' (O una de las dos)';

function headerFor(column: ColumnDefinition): string {
  const label = DISPLAY_HEADERS[column.key] ?? column.aliases[0];
  if (column.key === 'homeAddress' || column.key === 'workAddress') {
    return `${label}${ADDRESS_PAIR_SUFFIX}`;
  }
  return column.required ? `${label}${REQUIRED_SUFFIX}` : label;
}

function buildHeaders(columns: ColumnDefinition[]): string[] {
  return columns.map(headerFor);
}

// Row 1 = headers only, frozen so it stays visible while scrolling through
// many data rows — no second row of examples/instructions underneath it
// (removed 2026-09-06; required columns are now marked directly in the
// header text via headerFor() above instead). Shared by both workbooks
// this module builds, since parseClientsWorkbook expects the exact same
// single-header-row shape from either one — see FIRST_DATA_ROW in
// clientsImportParser.ts.
function freezeHeaderRow(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

// POST /clients/import-template — an empty workbook with exactly the
// columns the parser accepts, built from the same column definitions
// (clientsImportColumns.ts) so the template and the parser can never
// drift apart. Clients only — see apps/api/src/loanImport for assigning a
// loan to an existing client by cédula.
export async function buildImportTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clientes');

  const headers = buildHeaders(CLIENT_COLUMNS);
  sheet.addRow(headers);
  freezeHeaderRow(sheet);
  sheet.columns = headers.map(() => ({ width: 26 }));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Regenerates a workbook containing only the rows that failed a given
// import attempt, with their original values pre-filled plus a trailing
// "Motivo del error" column — so the admin can fix just what's wrong and
// re-upload through the exact same endpoint, instead of retyping
// everything from scratch. Stateless: the caller (frontend) already has
// this exact `RowError[]` from the import response, nothing is persisted
// server-side between the import attempt and this call.
export async function buildImportErrorsWorkbook(
  errors: RowError[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Filas con error');

  const columns = allColumnDefinitions();
  const headers = [...buildHeaders(columns), 'Motivo del error'];
  sheet.addRow(headers);
  freezeHeaderRow(sheet);
  sheet.columns = headers.map(() => ({ width: 26 }));

  for (const error of errors) {
    const values = columns.map((column) => error.rawValues[column.key] ?? '');
    sheet.addRow([...values, error.reason]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
