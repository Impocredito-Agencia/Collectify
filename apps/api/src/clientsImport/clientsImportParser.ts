import ExcelJS from 'exceljs';

import {
  allColumnDefinitions,
  CLIENT_COLUMNS,
  ColumnDefinition,
} from './clientsImportColumns';

export interface ParsedClientRow {
  row: number;
  client: Record<string, string | number>;
  // Every column's raw cell text, success or not — carried through so a
  // failure detected downstream (ClientsImportService, not this parser —
  // e.g. a repeated cédula with conflicting data) can still regenerate a
  // fully accurate "download errors" row.
  rawValues: Record<string, string>;
}

export interface RowError {
  row: number;
  reason: string;
  // The raw (unparsed) cell text for every known column in this row —
  // carried along so a failed row can be written back out verbatim into
  // the "download errors" file (clientsImportTemplate.ts
  // buildImportErrorsWorkbook) for the admin to fix and re-upload, without
  // anyone having to retype the whole row from scratch.
  rawValues: Record<string, string>;
}

export interface ClientParseResult {
  rows: ParsedClientRow[];
  errors: RowError[];
}

// Row 1 = headers, row 2 onward = real data — every workbook this module
// accepts (the downloaded template and the errors-export file alike) has
// this same fixed shape. There used to be a fill-in-instructions row
// between the two (removed 2026-09-06, human request — required columns
// are now marked directly in the header text instead, see
// clientsImportTemplate.ts's headerFor()), which is why this was 3 before.
const FIRST_DATA_ROW = 2;

// ExcelJS hands back rich-text/formula cells as objects, not plain values.
function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    if ('text' in value) {
      return cellText(value.text);
    }
    if ('result' in value) {
      return cellText(value.result);
    }
  }
  return '';
}

// Strips a trailing parenthetical note — e.g. "Nombre (O)" or "Dirección de
// residencia (O una de las dos)" — before matching against `aliases`.
// clientsImportTemplate.ts's headerFor() appends these to mark required
// columns directly in the header text (added 2026-09-06, replacing the old
// separate instructions row), so without this the generated template's own
// headers would stop matching their own column definitions, making every
// column look missing. Aliases never contain parentheses, so this is safe.
function stripRequiredMarker(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*$/, '');
}

function normalizeHeader(value: unknown): string {
  return stripRequiredMarker(cellText(value))
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

// Parses the clients-only workbook. Throws on structural problems (no
// sheet, unreadable file, missing required columns) — those abort the
// whole import. Per-row problems are collected into `errors` instead of
// thrown, so one bad row doesn't sink the rest.
export async function parseClientsWorkbook(
  buffer: Buffer,
): Promise<ClientParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('The uploaded file has no sheets');
  }

  const allColumns = allColumnDefinitions();
  const columnNumberByKey = new Map<string, number>();

  sheet.getRow(1).eachCell((cell, colNumber) => {
    const normalized = normalizeHeader(cell.value);
    for (const column of allColumns) {
      if (column.aliases.includes(normalized)) {
        columnNumberByKey.set(column.key, colNumber);
      }
    }
  });

  const missingRequired = allColumns.filter(
    (column) => column.required && !columnNumberByKey.has(column.key),
  );
  if (missingRequired.length > 0) {
    throw new Error(
      `The file is missing required column(s): ${missingRequired
        .map((column) => column.aliases[0])
        .join(', ')}`,
    );
  }

  const rows: ParsedClientRow[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    // Row 1 = headers, skipped — real data starts at row 2.
    if (rowNumber < FIRST_DATA_ROW) {
      return;
    }

    const rawValues: Record<string, string> = {};
    for (const column of allColumns) {
      const colNumber = columnNumberByKey.get(column.key);
      rawValues[column.key] = colNumber
        ? cellText(row.getCell(colNumber).value)
        : '';
    }

    const isBlankRow = Object.values(rawValues).every((value) => value === '');
    if (isBlankRow) {
      return;
    }

    const rowErrors: string[] = [];
    const client: Record<string, string | number> = {};
    parseColumnGroup(CLIENT_COLUMNS, rawValues, client, rowErrors);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join('; '), rawValues });
      return;
    }

    rows.push({ row: rowNumber, client, rawValues });
  });

  return { rows, errors };
}

function parseColumnGroup(
  columns: ColumnDefinition[],
  rawValues: Record<string, string>,
  target: Record<string, string | number>,
  rowErrors: string[],
): void {
  for (const column of columns) {
    const raw = rawValues[column.key] ?? '';

    if (raw === '') {
      if (column.required) {
        rowErrors.push(`Falta valor para: ${column.aliases[0]}`);
      }
      continue;
    }

    if (column.enumValues) {
      const normalized = raw
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim()
        .toLowerCase();
      const mapped = column.enumValues[normalized];
      if (!mapped) {
        rowErrors.push(`Valor inválido para ${column.aliases[0]}: "${raw}"`);
        continue;
      }
      target[column.key] = mapped;
      continue;
    }

    if (column.type === 'number') {
      const value = Number(raw.replace(',', '.'));
      if (Number.isNaN(value)) {
        rowErrors.push(
          `Valor numérico inválido para ${column.aliases[0]}: "${raw}"`,
        );
        continue;
      }
      target[column.key] = value;
      continue;
    }

    // 'string' and 'date' both pass through as text — date-string
    // validation (IsDateString) happens downstream via class-validator,
    // same as every other DTO in this codebase, so the parser doesn't
    // duplicate that logic here.
    target[column.key] = raw;
  }
}
