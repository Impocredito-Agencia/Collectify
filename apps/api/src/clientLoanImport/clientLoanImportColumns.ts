// Single source of truth for every column in the combined clients+loans
// Excel import — both clientLoanImportTemplate.ts (the downloadable
// template) and clientLoanImportParser.ts (the upload parser) build off
// this same list, so the two can never drift out of sync with each other.
// See docs/phasesClient/PHASE_8_POLISH.md and the client-confirmed scope
// (2026-08-19) for the business rules this reflects: one row = one credit
// (the same cédula can repeat across rows for a client with several
// loans), up to 4 "cargo adicional" groups per row, and no photo/URL or
// reference fields (those stay manual, per the client's own call).

export type ColumnValueType = 'string' | 'number' | 'date';

export interface ColumnDefinition {
  key: string;
  // First alias is also the header written into the generated template —
  // pick the clearest Spanish label for that slot. The rest are accepted
  // on upload (normalized: accents stripped, lowercased, trimmed), same
  // convention as clientsImportParser.ts.
  aliases: string[];
  required: boolean;
  type: ColumnValueType;
  // Only for enum-shaped columns (documentType, installmentFrequency, and
  // each "cargo adicional" group's Tipo column) — maps normalized input
  // text to the stored enum value. Absent for plain string/number/date
  // columns.
  enumValues?: Record<string, string>;
}

// --- Client columns -------------------------------------------------

export const CLIENT_COLUMNS: ColumnDefinition[] = [
  {
    key: 'firstName',
    aliases: ['nombre', 'nombres', 'first name', 'firstname'],
    required: true,
    type: 'string',
  },
  {
    key: 'lastName',
    aliases: ['apellido', 'apellidos', 'last name', 'lastname'],
    required: true,
    type: 'string',
  },
  {
    key: 'documentNumber',
    aliases: [
      'cedula',
      'documento',
      'numero de documento',
      'no de documento',
      'no documento',
      'document number',
    ],
    required: true,
    type: 'string',
  },
  {
    key: 'phoneNumber',
    aliases: [
      'telefono',
      'celular',
      'numero de telefono',
      'phone',
      'phone number',
    ],
    required: true,
    type: 'string',
  },
  {
    key: 'creditLimit',
    aliases: ['cupo', 'limite de credito', 'credit limit'],
    required: false,
    type: 'number',
  },
  {
    key: 'documentType',
    aliases: ['tipo de documento', 'document type'],
    required: false,
    type: 'string',
    enumValues: {
      'cedula de ciudadania': 'cedula_ciudadania',
      cc: 'cedula_ciudadania',
      'cedula de extranjeria': 'cedula_extranjeria',
      ce: 'cedula_extranjeria',
      pasaporte: 'pasaporte',
      passport: 'pasaporte',
    },
  },
  {
    key: 'dateOfBirth',
    aliases: ['fecha de nacimiento', 'date of birth'],
    required: false,
    type: 'date',
  },
  {
    key: 'documentIssuePlace',
    aliases: ['lugar de expedicion', 'document issue place'],
    required: false,
    type: 'string',
  },
  {
    key: 'documentIssueDate',
    aliases: ['fecha de expedicion', 'document issue date'],
    required: false,
    type: 'date',
  },
  {
    key: 'email',
    aliases: ['correo', 'correo electronico', 'email'],
    required: false,
    type: 'string',
  },
  {
    key: 'alternatePhoneNumber',
    aliases: [
      'telefono alterno',
      'telefono secundario',
      'alternate phone number',
    ],
    required: false,
    type: 'string',
  },
  {
    key: 'homeAddress',
    aliases: [
      'direccion de residencia',
      'direccion residencia',
      'home address',
    ],
    required: false,
    type: 'string',
  },
  {
    key: 'workAddress',
    aliases: ['direccion de trabajo', 'direccion laboral', 'work address'],
    required: false,
    type: 'string',
  },
  {
    key: 'neighborhood',
    aliases: ['barrio', 'neighborhood'],
    required: false,
    type: 'string',
  },
  {
    key: 'city',
    aliases: ['ciudad', 'city'],
    required: false,
    type: 'string',
  },
  {
    key: 'occupation',
    aliases: ['ocupacion', 'occupation'],
    required: false,
    type: 'string',
  },
  {
    key: 'employerName',
    aliases: ['empresa', 'lugar de trabajo', 'employer name'],
    required: false,
    type: 'string',
  },
  {
    key: 'monthlyIncome',
    aliases: ['ingresos mensuales', 'monthly income'],
    required: false,
    type: 'number',
  },
];

// --- Loan columns -----------------------------------------------------

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
    required: false,
    type: 'string',
  },
];

// --- "Cargo adicional" groups (interest/fee concepts) ------------------
// Up to 4 per row, confirmed with the client (2026-08-19) — enough
// headroom for the near future without unbounded columns. Bumping this
// later is a one-line change plus regenerating the template, not a
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
  return [...CLIENT_COLUMNS, ...LOAN_COLUMNS, ...conceptColumns];
}
