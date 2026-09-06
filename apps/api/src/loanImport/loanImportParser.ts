import ExcelJS from 'exceljs';

import {
  allColumnDefinitions,
  buildConceptColumnGroups,
  CLIENT_LOOKUP_COLUMNS,
  ColumnDefinition,
  LOAN_COLUMNS,
} from './loanImportColumns';

export interface ParsedConceptRow {
  name: string;
  calculationType: string;
  value: number;
}

export interface ParsedLoanRow {
  row: number;
  documentNumber: string;
  loan: Record<string, string | number>;
  concepts: ParsedConceptRow[];
  // Every column's raw cell text, success or not — carried through so a
  // failure detected downstream (LoanImportService, not this parser —
  // e.g. no client with that cédula) can still regenerate a fully
  // accurate "download errors" row, including the "Cargo adicional"
  // columns, which don't otherwise survive into the parsed `concepts`
  // array.
  rawValues: Record<string, string>;
}

export interface RowError {
  row: number;
  reason: string;
  // The raw (unparsed) cell text for every known column in this row —
  // carried along so a failed row can be written back out verbatim into
  // the "download errors" file (loanImportTemplate.ts
  // buildImportErrorsWorkbook) for the admin to fix and re-upload,
  // without anyone having to retype the whole row from scratch.
  rawValues: Record<string, string>;
}

export interface LoanParseResult {
  rows: ParsedLoanRow[];
  errors: RowError[];
}

// Row 1 = headers, row 2 = fill-in instructions — every workbook this
// module accepts (the downloaded template and the errors-export file
// alike) has this same fixed shape, so real data always starts here.
const FIRST_DATA_ROW = 3;

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

function normalizeHeader(value: unknown): string {
  return cellText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

// Parses the loan-only workbook. Throws on structural problems (no sheet,
// unreadable file, missing required columns) — those abort the whole
// import. Per-row problems are collected into `errors` instead of
// thrown, so one bad row doesn't sink the rest. Whether the row's cédula
// actually matches an existing client is NOT checked here — that's a
// business lookup, done downstream in LoanImportService.
export async function parseLoansWorkbook(
  buffer: Buffer,
): Promise<LoanParseResult> {
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

  const conceptGroups = buildConceptColumnGroups();
  const rows: ParsedLoanRow[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    // Row 1 = headers, row 2 = the fill-in instructions/examples row
    // (loanImportTemplate.ts addInstructionsRow) — always skipped,
    // regardless of what ends up written there. Data starts at row 3.
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

    const clientLookup: Record<string, string | number> = {};
    parseColumnGroup(CLIENT_LOOKUP_COLUMNS, rawValues, clientLookup, rowErrors);

    const loan: Record<string, string | number> = {};
    parseColumnGroup(LOAN_COLUMNS, rawValues, loan, rowErrors);

    const concepts: ParsedConceptRow[] = [];
    for (const group of conceptGroups) {
      const name = rawValues[group.nameColumn.key];
      const typeRaw = rawValues[group.typeColumn.key];
      const valueRaw = rawValues[group.valueColumn.key];

      // A blank "Nombre" means the whole group is unused — Tipo/Valor are
      // ignored even if something stray was left in them.
      if (name === '') {
        continue;
      }

      const normalizedType = typeRaw
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim()
        .toLowerCase();
      const calculationType = group.typeColumn.enumValues?.[normalizedType];
      if (!calculationType) {
        rowErrors.push(
          `Cargo adicional #${group.index}: tipo inválido o vacío ("${typeRaw}") — use "porcentaje" o "fijo"`,
        );
        continue;
      }

      const value = Number(valueRaw.replace(',', '.'));
      if (valueRaw === '' || Number.isNaN(value) || value < 0) {
        rowErrors.push(
          `Cargo adicional #${group.index}: valor inválido o vacío ("${valueRaw}")`,
        );
        continue;
      }

      concepts.push({ name, calculationType, value });
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join('; '), rawValues });
      return;
    }

    rows.push({
      row: rowNumber,
      documentNumber: String(clientLookup.documentNumber ?? ''),
      loan,
      concepts,
      rawValues,
    });
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
