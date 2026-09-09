// Single source of truth for every column in the clients-only Excel
// import — both clientsImportTemplate.ts (the downloadable template) and
// clientsImportParser.ts (the upload parser) build off this same list, so
// the two can never drift out of sync with each other.
//
// Split 2026-09-06 (human request): this used to be a combined
// clients+loans import (docs/phasesClient/PHASE_8_POLISH.md) requiring a
// full loan on every row, which blocked bulk-loading a plain client list
// with no loan data yet. Loan columns and "cargo adicional" groups moved
// to their own module — see apps/api/src/loanImport, which looks a client
// up by cédula instead of creating one.

export type ColumnValueType = 'string' | 'number' | 'date';

export interface ColumnDefinition {
  key: string;
  // First alias is also the header written into the generated template —
  // pick the clearest Spanish label for that slot. The rest are accepted
  // on upload (normalized: accents stripped, lowercased, trimmed).
  aliases: string[];
  required: boolean;
  type: ColumnValueType;
  // Only for enum-shaped columns (documentType) — maps normalized input
  // text to the stored enum value. Absent for plain string/number/date
  // columns.
  enumValues?: Record<string, string>;
}

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
    key: 'gender',
    aliases: ['sexo', 'genero', 'género', 'gender'],
    required: false,
    type: 'string',
    enumValues: {
      masculino: 'masculino',
      m: 'masculino',
      hombre: 'masculino',
      male: 'masculino',
      femenino: 'femenino',
      f: 'femenino',
      mujer: 'femenino',
      female: 'femenino',
      otro: 'otro',
      other: 'otro',
    },
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

export function allColumnDefinitions(): ColumnDefinition[] {
  return CLIENT_COLUMNS;
}
