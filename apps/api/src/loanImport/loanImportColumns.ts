// Single source of truth for every column in the loan-only Excel import
// — both loanImportTemplate.ts (the downloadable template) and
// loanImportParser.ts (the upload parser) build off this same list, so
// the two can never drift out of sync with each other.
//
// Added 2026-09-06, split off the old combined clients+loans importer
// (docs/phasesClient/PHASE_8_POLISH.md) — that one required a full client
// profile on every row, which blocked bulk-loading loans for clients that
// were already imported separately (see apps/api/src/clientsImport). This
// module instead looks a client up by cédula: the client must already
// exist, or the row is skipped as a row error.

export type ColumnValueType = 'string' | 'number' | 'date';

export interface ColumnDefinition {
  key: string;
  // First alias is also the header written into the generated template —
  // pick the clearest Spanish label for that slot. The rest are accepted
  // on upload (normalized: accents stripped, lowercased, trimmed).
  aliases: string[];
  required: boolean;
  type: ColumnValueType;
  // Only for enum-shaped columns (installmentFrequency and each "cargo
  // adicional" group's Tipo column) — maps normalized input text to the
  // stored enum value. Absent for plain string/number/date columns.
  enumValues?: Record<string, string>;
}

// The column used to find the loan's client — the client must already
// exist (created via apps/api/src/clientsImport or the interactive
// "Nuevo cliente" form); this import never creates one.
export const CLIENT_LOOKUP_COLUMNS: ColumnDefinition[] = [
  {
    key: 'documentNumber',
    aliases: [
      'cedula',
      'cedula del cliente',
      'documento',
      'numero de documento',
      'no de documento',
      'no documento',
      'document number',
    ],
    required: true,
    type: 'string',
  },
];

export const LOAN_COLUMNS: ColumnDefinition[] = [
  {
    key: 'promissoryNoteNumber',
    aliases: ['pagare', 'numero de pagare', 'promissory note number'],
    required: true,
    type: 'string',
  },
  {
    key: 'principalAmount',
    aliases: ['monto del credito', 'monto', 'principal amount'],
    required: true,
    type: 'number',
  },
  {
    key: 'interestRate',
    aliases: ['tasa moratoria', 'tasa de interes moratoria', 'interest rate'],
    required: true,
    type: 'number',
  },
  {
    key: 'disbursedAt',
    aliases: ['fecha de desembolso', 'disbursed at'],
    required: true,
    type: 'date',
  },
  {
    key: 'installmentFrequency',
    aliases: ['frecuencia de pago', 'frecuencia', 'installment frequency'],
    required: true,
    type: 'string',
    enumValues: {
      mensual: 'monthly',
      monthly: 'monthly',
      quincenal: 'biweekly',
      biweekly: 'biweekly',
    },
  },
  {
    key: 'totalInstallments',
    aliases: ['numero de cuotas', 'plazo', 'total installments'],
    required: true,
    type: 'number',
  },
  {
    key: 'description',
    aliases: ['descripcion del credito', 'descripcion', 'description'],
    required: true,
    type: 'string',
  },
];

// --- "Cargo adicional" groups (interest/fee concepts) ------------------
// Up to 4 per row, same convention as the old combined importer. Bumping
// this later is a one-line change plus regenerating the template, not a
// parser rewrite.

export const MAX_IMPORT_CONCEPTS_PER_ROW = 4;

const CONCEPT_CALCULATION_TYPE_ALIASES: Record<string, string> = {
  porcentaje: 'percentage',
  '%': 'percentage',
  percentage: 'percentage',
  fijo: 'fixed_amount',
  'monto fijo': 'fixed_amount',
  fixed: 'fixed_amount',
  fixed_amount: 'fixed_amount',
};

export interface ConceptColumnGroup {
  index: number;
  nameColumn: ColumnDefinition;
  typeColumn: ColumnDefinition;
  valueColumn: ColumnDefinition;
}

export function buildConceptColumnGroups(): ConceptColumnGroup[] {
  return Array.from(
    { length: MAX_IMPORT_CONCEPTS_PER_ROW },
    (_, index): ConceptColumnGroup => {
      const n = index + 1;
      return {
        index: n,
        nameColumn: {
          key: `concept${n}Name`,
          aliases: [`cargo adicional #${n} - nombre`],
          required: false,
          type: 'string',
        },
        typeColumn: {
          key: `concept${n}Type`,
          aliases: [`cargo adicional #${n} - tipo`],
          required: false,
          type: 'string',
          enumValues: CONCEPT_CALCULATION_TYPE_ALIASES,
        },
        valueColumn: {
          key: `concept${n}Value`,
          aliases: [`cargo adicional #${n} - valor`],
          required: false,
          type: 'number',
        },
      };
    },
  );
}

export function allColumnDefinitions(): ColumnDefinition[] {
  const conceptColumns = buildConceptColumnGroups().flatMap((group) => [
    group.nameColumn,
    group.typeColumn,
    group.valueColumn,
  ]);
  return [...CLIENT_LOOKUP_COLUMNS, ...LOAN_COLUMNS, ...conceptColumns];
}
