import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/clients/entities/client.entity.ts's DocumentType
// exactly. As of Phase 26, a loan's co-debtor is a linked Client rather
// than its own flat document-type field, so this is read via
// Loan.coDebtorClient.documentType instead of a separate enum reference.
export enum DocumentType {
  CedulaCiudadania = 'cedula_ciudadania',
  CedulaExtranjeria = 'cedula_extranjeria',
  Pasaporte = 'pasaporte',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  [DocumentType.CedulaCiudadania]: 'Cédula de ciudadanía',
  [DocumentType.CedulaExtranjeria]: 'Cédula de extranjería',
  [DocumentType.Pasaporte]: 'Pasaporte',
};

// Matches apps/api/src/clients/entities/client.entity.ts's Gender exactly.
// Client request, 2026-09-08 — nullable, never required.
export enum Gender {
  Male = 'masculino',
  Female = 'femenino',
  Other = 'otro',
}

export const GENDER_LABELS: Record<Gender, string> = {
  [Gender.Male]: 'Masculino',
  [Gender.Female]: 'Femenino',
  [Gender.Other]: 'Otro',
};

// Matches apps/api/src/clients/entities/clientReference.entity.ts exactly.
// A dynamic add-many list per client, no fixed min/max — see
// docs/phases/PHASE_21_CLIENT_PROFILE.md decision 2.
export enum ClientReferenceType {
  Personal = 'personal',
  Comercial = 'comercial',
}

export const CLIENT_REFERENCE_TYPE_LABELS: Record<ClientReferenceType, string> =
  {
    [ClientReferenceType.Personal]: 'Personal',
    [ClientReferenceType.Comercial]: 'Comercial',
  };

export interface ClientReference {
  id: string;
  clientId: string;
  type: ClientReferenceType;
  fullName: string;
  phoneNumber: string;
  relationship: string;
  createdAt: string;
  updatedAt: string;
}

// Matches apps/api/src/clients/dto/createClientReference.dto.ts /
// updateClientReference.dto.ts.
export interface CreateClientReferenceInput {
  type: ClientReferenceType;
  fullName: string;
  phoneNumber: string;
  relationship: string;
}

export type UpdateClientReferenceInput = Partial<CreateClientReferenceInput>;

// Matches apps/api/src/clients/entities/client.entity.ts exactly, including
// the Phase 21 extended profile fields. The Figma form (Phase 3) also
// showed "Correo electrónico" and "Dirección" that didn't exist on the
// entity at the time — both are now real (email, homeAddress), added by
// Phase 21, not the original Figma request. See apps/client/docs/
// DESIGN_TOKENS.md "Known design/backend gaps".
export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  phoneNumber: string;
  // Nullable — unset means no cupo enforced for this client. See
  // docs/phases/PHASE_10_CLIENT_CAPACITY.md.
  creditLimit: number | null;

  // --- Extended profile (KYC), Phase 21 — all nullable. See
  // docs/phases/PHASE_21_CLIENT_PROFILE.md for the confirmed field list. ---
  documentType: DocumentType | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  documentIssuePlace: string | null;
  documentIssueDate: string | null;
  email: string | null;
  alternatePhoneNumber: string | null;
  homeAddress: string | null;
  workAddress: string | null;
  city: string | null;
  occupation: string | null;
  employerName: string | null;
  monthlyIncome: number | null;
  idDocumentFrontUrl: string | null;
  idDocumentBackUrl: string | null;
  // Never required anywhere in this app — sensitive/biometric data under
  // Ley 1581 de 2012, see the Phase 21 legal summary. Always optional.
  selfieImageUrl: string | null;
  dataProcessingConsent: boolean;
  consentGivenAt: string | null;
  consentDocumentUrl: string | null;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// Phase 27 — throttles how often overdue/upcoming_due reminders reach this
// client; never controls eligibility. null (on ClientDetail) means the
// client is never throttled. See docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.
export interface ClientMessageFrequency {
  id: string;
  clientId: string;
  minimumDaysBetweenMessages: number;
  createdAt: string;
  updatedAt: string;
}

// What GET /clients/:id returns — Client plus fields computed on read by
// ClientsService.findOneDetail, never stored, plus this client's
// references (Phase 21) and message frequency override (Phase 27). GET
// /clients (list) returns plain Client rows without any of these, per the
// backend's findAll/findOneDetail split. See
// docs/phases/PHASE_10_CLIENT_CAPACITY.md.
export interface ClientDetail extends Client {
  creditUsed: number;
  creditAvailable: number | null;
  isMoraBlocked: boolean;
  references: ClientReference[];
  messageFrequency: ClientMessageFrequency | null;
  messageRecipients: ClientMessageRecipient[];
}

// Human report, 2026-09-23 — every number that can receive a collection
// reminder for this client, and whether reminders are turned off for it.
// Mirrors apps/api's ClientsService.ClientMessageRecipient.
// alternate_contact = a loan's third party (not the co-debtor).
export interface ClientMessageRecipient {
  phoneNumber: string;
  kind: 'primary' | 'alternate' | 'alternate_contact';
  contactName: string | null;
  promissoryNoteNumbers: string[];
  muted: boolean;
}

// What GET /clients (list) returns per row — plain Client fields plus two
// counts computed in one batched pass over the page (ClientsService.
// enrichClientListItems), not stored columns. maxOverdueDays uses the same
// "any overdueDays > 0" definition as ClientDetailPage's "En mora" stat and
// Dashboard's per-client mora badge — NOT the stricter >30-day threshold
// used by isMoraBlocked/hasMoraBlock (that one only gates new loan
// creation). See docs/phases — added 2026-09-06 to fill the unused
// horizontal space on the Clientes list.
export interface ClientListItem extends Client {
  activeLoanCount: number;
  maxOverdueDays: number;
}

// Mirrors the backend's OverdueInstallmentResult/UpcomingInstallmentResult
// (whatsapp/reminderInstallmentQueries.ts) field-for-field — see
// ClientsService.getAccountStatus's own comment on why this reuses those
// exact queries instead of a separate calculation.
export interface OverdueInstallment {
  id: string;
  loanId: string;
  alternateContactPhoneNumber: string | null;
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  totalDue: number;
  overdueDays: number;
  interest: number;
}

export interface UpcomingInstallment {
  id: string;
  loanId: string;
  alternateContactPhoneNumber: string | null;
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  daysUntilDue: number;
}

export interface ClientAccountStatus {
  overdue: OverdueInstallment[];
  upcoming: UpcomingInstallment[];
}

export interface ClientsQueryParams {
  search?: string;
  // true = active (default), false = soft-deleted, 'all' = both — the
  // backend originally only supported a strict boolean; 'all' was added to
  // ClientsService.findAll/QueryClientsDto specifically to back the "Todos"
  // tab (see ClientsListPage.tsx).
  isActive?: boolean | 'all';
  page?: number;
  limit?: number;
}

export interface PaginatedClients {
  items: ClientListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Matches apps/api/src/clients/dto/createClient.dto.ts exactly. Every
// Phase 21 field is optional at this type level — dataProcessingConsent is
// enforced as required by ClientForm.tsx's own validation (a checkbox that
// blocks submit), not by this type, since Excel-imported clients go
// through a different path that's deliberately exempt (decision 6).
export interface CreateClientInput {
  firstName: string;
  lastName: string;
  documentNumber: string;
  phoneNumber: string;
  // Omitted (not 0/null) means no cupo enforced — see CreateClientDto's
  // @IsOptional() @IsPositive(). There is currently no way to explicitly
  // clear a previously-set cupo via PATCH; see DESIGN_TOKENS.md "Known
  // design/backend gaps".
  creditLimit?: number;
  documentType?: DocumentType;
  dateOfBirth?: string;
  gender?: Gender;
  documentIssuePlace?: string;
  documentIssueDate?: string;
  email?: string;
  alternatePhoneNumber?: string;
  homeAddress?: string;
  workAddress?: string;
  city?: string;
  occupation?: string;
  employerName?: string;
  monthlyIncome?: number;
  idDocumentFrontUrl?: string;
  idDocumentBackUrl?: string;
  selfieImageUrl?: string;
  dataProcessingConsent?: boolean;
  consentDocumentUrl?: string;
}

export type UpdateClientInput = Partial<CreateClientInput>;

export const clientsApi = {
  getAll: async (
    params: ClientsQueryParams = {},
  ): Promise<PaginatedClients> => {
    const { data, meta } = await apiClient.get<ClientListItem[]>('/clients', {
      search: params.search,
      isActive: params.isActive,
      page: params.page,
      limit: params.limit,
    });
    return { items: data, meta: meta as PaginatedClients['meta'] };
  },

  getOne: async (id: string): Promise<ClientDetail> => {
    const { data } = await apiClient.get<ClientDetail>(`/clients/${id}`);
    return data;
  },

  create: async (input: CreateClientInput): Promise<Client> => {
    const { data } = await apiClient.post<Client>('/clients', input);
    return data;
  },

  update: async (id: string, input: UpdateClientInput): Promise<Client> => {
    const { data } = await apiClient.patch<Client>(`/clients/${id}`, input);
    return data;
  },

  // Soft-deletes the client (this is what "Desactivar" does).
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/clients/${id}`);
  },

  // Restores a soft-deleted client. Admin only — see
  // docs/phases/PHASE_10_CLIENT_CAPACITY.md.
  reactivate: async (id: string): Promise<Client> => {
    const { data } = await apiClient.patch<Client>(`/clients/${id}/reactivate`);
    return data;
  },

  // Phase 21 — references sub-resource. Kept on this same api object
  // (rather than a separate clientReferencesApi) since every call is
  // always scoped to a clientId and there's no standalone references
  // screen — matches how e.g. loansApi.getPayments lives alongside loansApi
  // rather than in its own file.
  addReference: async (
    clientId: string,
    input: CreateClientReferenceInput,
  ): Promise<ClientReference> => {
    const { data } = await apiClient.post<ClientReference>(
      `/clients/${clientId}/references`,
      input,
    );
    return data;
  },

  updateReference: async (
    clientId: string,
    referenceId: string,
    input: UpdateClientReferenceInput,
  ): Promise<ClientReference> => {
    const { data } = await apiClient.patch<ClientReference>(
      `/clients/${clientId}/references/${referenceId}`,
      input,
    );
    return data;
  },

  removeReference: async (
    clientId: string,
    referenceId: string,
  ): Promise<void> => {
    await apiClient.delete(`/clients/${clientId}/references/${referenceId}`);
  },

  // Human report, 2026-09-23 — replaces the client's full set of muted
  // numbers; [] turns every number back on.
  setMutedPhoneNumbers: async (
    clientId: string,
    phoneNumbers: string[],
  ): Promise<ClientMessageRecipient[]> => {
    const { data } = await apiClient.put<ClientMessageRecipient[]>(
      `/clients/${clientId}/muted-phone-numbers`,
      { phoneNumbers },
    );
    return data;
  },

  // Phase 27 — message frequency whitelist. setMessageFrequency both
  // creates and updates (PUT upsert); clearMessageFrequency removes the
  // entry outright, going back to "never throttled".
  setMessageFrequency: async (
    clientId: string,
    minimumDaysBetweenMessages: number,
  ): Promise<ClientMessageFrequency> => {
    const { data } = await apiClient.put<ClientMessageFrequency>(
      `/clients/${clientId}/message-frequency`,
      { minimumDaysBetweenMessages },
    );
    return data;
  },

  clearMessageFrequency: async (clientId: string): Promise<void> => {
    await apiClient.delete(`/clients/${clientId}/message-frequency`);
  },

  // Human report, 2026-09-14 — saldo a favor: a client-level credit
  // generated when a payment exceeds what its installment owed. See
  // ClientCreditBanner.tsx and docs/DATABASE.md's client_credit_ledger_entries
  // note.
  getCreditBalance: async (clientId: string): Promise<{ balance: number }> => {
    const { data } = await apiClient.get<{ balance: number }>(
      `/clients/${clientId}/credit-balance`,
    );
    return data;
  },

  // Human request, 2026-09-15 — front-desk lookup, see
  // ClientAccountStatusPanel.tsx's own comment. Mirrors the backend's
  // OverdueInstallmentResult/UpcomingInstallmentResult exactly (same
  // fields as reminderInstallmentQueries.ts) so this never needs its own
  // remapping.
  getAccountStatus: async (clientId: string): Promise<ClientAccountStatus> => {
    const { data } = await apiClient.get<ClientAccountStatus>(
      `/clients/${clientId}/account-status`,
    );
    return data;
  },
};
