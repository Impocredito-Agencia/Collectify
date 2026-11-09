import type {
  CreateClientInput,
  DocumentType,
  Gender,
} from '@/features/clients/clientsApi';

// Raw form state, exactly as ClientForm keeps it — '' / 0 mean "empty".
export interface ClientFormValues {
  firstName: string;
  lastName: string;
  documentNumber: string;
  phoneNumber: string;
  creditLimit: number;
  documentType: string;
  dateOfBirth: string;
  gender: string;
  documentIssuePlace: string;
  documentIssueDate: string;
  email: string;
  alternatePhoneNumber: string;
  homeAddress: string;
  workAddress: string;
  city: string;
  occupation: string;
  employerName: string;
  monthlyIncome: number;
  dataProcessingConsent: boolean;
}

// Builds the POST/PATCH body for ClientForm. An empty optional field is
// omitted when creating, but sent as null when editing: PATCH /clients/:id
// leaves omitted fields untouched (Object.assign in ClientsService.update),
// so omitting it there meant clearing a saved value (e.g. borrar el celular
// secundario) silently did nothing. The backend's @IsOptional() accepts null.
export function buildClientPayload(
  values: ClientFormValues,
  isEditing: boolean,
): CreateClientInput {
  const empty = isEditing ? null : undefined;
  const text = (value: string) => value.trim() || empty;
  const positive = (value: number) => (value > 0 ? value : empty);

  return {
    firstName: values.firstName,
    lastName: values.lastName,
    documentNumber: values.documentNumber,
    phoneNumber: values.phoneNumber,
    creditLimit: positive(values.creditLimit),
    documentType: (values.documentType as DocumentType) || empty,
    dateOfBirth: values.dateOfBirth || empty,
    gender: (values.gender as Gender) || empty,
    documentIssuePlace: text(values.documentIssuePlace),
    documentIssueDate: values.documentIssueDate || empty,
    email: text(values.email),
    alternatePhoneNumber: text(values.alternatePhoneNumber),
    homeAddress: text(values.homeAddress),
    workAddress: text(values.workAddress),
    city: text(values.city),
    occupation: text(values.occupation),
    employerName: text(values.employerName),
    monthlyIncome: positive(values.monthlyIncome),
    dataProcessingConsent: values.dataProcessingConsent,
  };
}
