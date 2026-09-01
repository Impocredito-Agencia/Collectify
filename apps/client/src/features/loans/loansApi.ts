import { apiClient } from '@/lib/apiClient';

import type { Client } from '@/features/clients/clientsApi';
import type {
  ConceptBreakdownItem,
  Installment,
  Payment,
} from '@/features/installments/installmentsApi';
import type { ConceptCalculationType } from '@/features/interestConceptTypes/interestConceptTypesApi';

// Matches apps/api/src/loans/entities/loan.entity.ts exactly.
export enum InstallmentFrequency {
  Monthly = 'monthly',
  Biweekly = 'biweekly',
}

export enum LoanStatus {
  Active = 'active',
  Paid = 'paid',
  Refinanced = 'refinanced',
}

export interface Loan {
  id: string;
  clientId: string;
  promissoryNoteNumber: string;
  principalAmount: number;
  interestRate: number;
  disbursedAt: string;
  installmentFrequency: InstallmentFrequency;
  totalInstallments: number;
  status: LoanStatus;
  refinancedFromLoanId: string | null;
  description: string | null;
  // The "cuota inicial" — a down payment the client already made outside
  // the credit system to cover the part of the purchase this loan doesn't
  // finance. Purely informational: null when there was no down payment.
  // See docs/phases/PHASE_13_INITIAL_INSTALLMENT.md.
  initialPayment: number | null;
  // --- Co-debtor (codeudor), Phase 21 — belongs to the loan, not the
  // client: whether a given loan has one varies per loan. At most one per
  // loan. As of Phase 26, the co-debtor is an existing Client referenced
  // by id rather than free-typed flat fields — see
  // docs/phases/PHASE_26_CODEBTOR_CLIENT.md. coDebtorRelationship is the
  // one field that stayed standalone on Loan (it describes this specific
  // loan's relationship, not a property of the co-debtor themselves). ---
  coDebtorClientId: string | null;
  coDebtorRelationship: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// GET /loans (list) return shape — matches apps/api's LoanSummary. Added
// specifically for the standalone "Préstamos" screen (F-16/17), which is a
// different view from Clientes and needs to show whose loan it is plus
// collection status without opening it. clientFullName/outstandingBalance/
// installmentsPaid/overdueDays didn't exist on the API until this phase —
// LoansService.findAll now joins `client` and aggregates installments per
// loan to compute them. See DESIGN_TOKENS.md "Known design/backend gaps".
export interface LoanSummary extends Loan {
  clientFullName: string;
  outstandingBalance: number;
  installmentsPaid: number;
  overdueDays: number;
  // The due date of the oldest still-pending installment, whether it's
  // already overdue or upcoming — null when nothing's pending anymore
  // (fully paid/cancelled). Added post-Phase-5, client request: see
  // apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps".
  nextInstallmentDueDate: string | null;
  // Sum of totalDue across ONLY the overdue installments — unlike
  // outstandingBalance, which includes every pending installment whether
  // overdue or not. Use this one for "how much is actually late" (e.g. the
  // client's "En mora" stat); use outstandingBalance for "how much is left
  // on the whole loan". Added post-Phase-5, client request: see
  // apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps".
  overdueBalance: number;
}

// GET /loans/:id return shape (apps/api's LoanDetail). Does NOT include
// clientFullName — only the list endpoint (LoanSummary) was extended with
// it, since the detail page is always reached with the client already
// known (from the list row or ClientDetailPage).
export interface LoanDetail extends Loan {
  installments: Installment[];
  // Computed reverse lookup: the loan this one was later refinanced into,
  // if any. Only relevant once Phase 6 (refinancing) ships.
  refinancedToLoanId: string | null;
  // Phase 26 — coDebtorClientId resolved into a full client record, null
  // when the loan has no co-debtor. Resolved with withDeleted server-side
  // (ClientsService.findByIdIncludingDeleted), so a loan whose co-debtor
  // was later deactivated still renders instead of breaking this view.
  coDebtorClient: Client | null;
  // Phase 31 — "saldo capital a la fecha". Pure remaining principal across
  // still-pending installments, no accrued interest folded in — do not
  // confuse with the "Saldo pendiente con incremento" KPI (which does
  // include interest). See LoansService.findOne's own comment (api).
  currentPrincipalBalance: number;
}

export interface LoansQueryParams {
  clientId?: string;
  status?: LoanStatus;
  // Matches client name or promissory note number — added to
  // QueryLoansDto/LoansService.findAll for the Préstamos list's search box.
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedLoans {
  items: LoanSummary[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Matches apps/api/src/loans/dto/loanConceptAssignment.dto.ts's
// LoanConceptAssignmentDto exactly.
export interface LoanConceptAssignment {
  conceptTypeId: string;
  calculationType: ConceptCalculationType;
  value: number;
}

// Matches apps/api/src/loans/dto/createLoan.dto.ts exactly. As of Phase 14
// the installment schedule is generated by the API from principalAmount,
// totalInstallments, and concepts — solved as a level total payment
// ("cuota fija"), so concepts apply to every installment for the whole
// term and cannot vary per installment. interestRate is used only for
// moratory interest on overdue installments
// (docs/phases/PHASE_14_INTEREST_CONCEPTS.md).
export interface CreateLoanInput {
  clientId: string;
  promissoryNoteNumber: string;
  principalAmount: number;
  interestRate: number;
  disbursedAt: string;
  installmentFrequency: InstallmentFrequency;
  totalInstallments: number;
  concepts: LoanConceptAssignment[];
  // Phase 23 — moratory concepts assigned to this loan. Never baked into
  // the schedule/level payment (unlike concepts above) — they only take
  // effect once an installment is overdue, computed live on read. Omit or
  // leave empty for a loan with no moratory concepts, which keeps using
  // the legacy interestRate formula. See
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  moratoryConcepts?: LoanConceptAssignment[];
  // The "cuota inicial" — purely informational, doesn't affect the
  // schedule. Undefined when there was no down payment. See
  // docs/phases/PHASE_13_INITIAL_INSTALLMENT.md.
  initialPayment?: number;
  description?: string;
  // Optional co-debtor (codeudor), Phase 26 — an existing client's id,
  // picked via search rather than free-typed. Omit entirely for a loan
  // with none. See docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
  coDebtorClientId?: string;
  coDebtorRelationship?: string;
}

// Matches apps/api/src/loans/dto/previewSchedule.dto.ts exactly — the
// schedule-relevant subset of CreateLoanInput, for POST /loans/preview-schedule.
export type PreviewScheduleInput = Omit<
  CreateLoanInput,
  'clientId' | 'promissoryNoteNumber' | 'interestRate' | 'description'
>;

// Matches apps/api/src/loans/loans.service.ts's PreviewedInstallment exactly.
export interface PreviewedInstallment {
  installmentNumber: number;
  dueDate: string;
  principalPortion: number;
  amount: number;
  // Moratory items always preview at amount 0 — nothing is overdue in a
  // hypothetical schedule; shown so the admin can see which ones they
  // picked before committing. See docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  conceptBreakdown: ConceptBreakdownItem[];
}

// Matches apps/api/src/loans/loans.service.ts's SchedulePreview exactly. As
// of Phase 24, a percentage concept in conceptBreakdown is always priced at
// the current usury rate (see useCurrentUsuryRate) — there's no
// usuryWarning anymore, since a loan can no longer exceed the ceiling by
// construction. See docs/phases/PHASE_24_USURY_MANDATORY.md.
export interface SchedulePreview {
  installments: PreviewedInstallment[];
}

// Matches apps/api/src/loans/payoff/calculatePayoff.ts's PayoffQuote
// exactly. See docs/phases/PHASE_16_EARLY_PAYOFF.md — a not-yet-due
// installment contributes only principalApplied (its principalPortion),
// at face value, with interestApplied 0; a matured (due/overdue)
// installment's interestApplied includes both Phase 14 concept charges and
// any moratory interest.
export interface PayoffInstallmentBreakdown {
  installmentId: string;
  installmentNumber: number;
  interestApplied: number;
  principalApplied: number;
  totalDue: number;
}

export interface PayoffQuote {
  installments: PayoffInstallmentBreakdown[];
  totalInterestOwed: number;
  totalPrincipalOwed: number;
  totalDue: number;
}

// Matches apps/api/src/loans/loans.service.ts's RefinanceQuote exactly —
// see docs/phases/PHASE_17_REFINANCING_RECALC.md. Advisory only: reopens
// docs/phases/PHASE_6_REFINANCING.md's manual-entry decision, but
// suggestedPrincipalAmount and concepts are only a pre-fill — the admin
// keeps full editing control over what actually gets submitted.
export interface RefinanceQuote {
  payoff: PayoffQuote;
  suggestedPrincipalAmount: number;
  concepts: LoanConceptAssignment[];
  // Phase 23 — same carry-over as concepts above, filtered to the loan's
  // assigned moratory concepts.
  moratoryConcepts: LoanConceptAssignment[];
}

// Matches apps/api/src/loans/dto/updateLoan.dto.ts exactly — only these two
// fields are editable post-creation. principalAmount/schedule are NOT
// patchable (would cascade into already-generated installments, out of
// scope per the DTO's own comment).
export interface UpdateLoanInput {
  interestRate?: number;
  description?: string;
}

// Matches apps/api/src/loans/dto/refinanceLoan.dto.ts exactly — same shape
// as CreateLoanInput minus clientId (the new loan always belongs to the
// same client as the one being refinanced, enforced server-side). Phase 6:
// POST /loans/:id/refinance closes the old loan out (status: 'refinanced',
// its remaining pending installments marked 'cancelled' — confirmed
// business decision, see docs/DATABASE.md "Refinancing") and creates this
// new loan linked back via refinancedFromLoanId. Its schedule is generated
// the same way as loan creation, as of Phase 14.
export interface RefinanceLoanInput {
  promissoryNoteNumber: string;
  principalAmount: number;
  interestRate: number;
  disbursedAt: string;
  installmentFrequency: InstallmentFrequency;
  totalInstallments: number;
  concepts: LoanConceptAssignment[];
  // See CreateLoanInput.moratoryConcepts.
  moratoryConcepts?: LoanConceptAssignment[];
  // The new loan's own "cuota inicial" — see CreateLoanInput.
  initialPayment?: number;
  description?: string;
  // Optional co-debtor, Phase 26 — omitting both fields carries the old
  // loan's co-debtor over unchanged (LoansService.refinance's confirmed
  // default); sending either overrides just that field. Send null
  // explicitly (rather than omitting) to deliberately clear the co-debtor
  // on the new loan instead of carrying it over. See
  // docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
  coDebtorClientId?: string | null;
  coDebtorRelationship?: string | null;
}

export const loansApi = {
  getAll: async (params: LoansQueryParams = {}): Promise<PaginatedLoans> => {
    const { data, meta } = await apiClient.get<LoanSummary[]>('/loans', {
      clientId: params.clientId,
      status: params.status,
      search: params.search,
      page: params.page,
      limit: params.limit,
    });
    return { items: data, meta: meta as PaginatedLoans['meta'] };
  },

  getOne: async (id: string): Promise<LoanDetail> => {
    const { data } = await apiClient.get<LoanDetail>(`/loans/${id}`);
    return data;
  },

  // Admin only — enforced server-side via @Roles(UserRole.Admin); the UI
  // still hides the action for non-admins, consistent with Clientes.
  create: async (input: CreateLoanInput): Promise<LoanDetail> => {
    const { data } = await apiClient.post<LoanDetail>('/loans', input);
    return data;
  },

  // Runs the same schedule generation as create()/refinance() without
  // persisting anything — lets LoanForm.tsx/RefinanceLoanForm.tsx show the
  // admin what the installments will look like before they submit.
  previewSchedule: async (
    input: PreviewScheduleInput,
  ): Promise<SchedulePreview> => {
    const { data } = await apiClient.post<SchedulePreview>(
      '/loans/preview-schedule',
      input,
    );
    return data;
  },

  update: async (id: string, input: UpdateLoanInput): Promise<Loan> => {
    const { data } = await apiClient.patch<Loan>(`/loans/${id}`, input);
    return data;
  },

  // Added for the loan detail screen's "Historial de pagos" (F-19) — there
  // was previously no way to list a loan's payments at all on the backend,
  // only register one. See LoansService.getPayments.
  getPayments: async (id: string): Promise<Payment[]> => {
    const { data } = await apiClient.get<Payment[]>(`/loans/${id}/payments`);
    return data;
  },

  // Read-only, safe to call regardless of the loan's status — see
  // docs/phases/PHASE_16_EARLY_PAYOFF.md.
  getPayoffQuote: async (id: string): Promise<PayoffQuote> => {
    const { data } = await apiClient.get<PayoffQuote>(
      `/loans/${id}/payoff-quote`,
    );
    return data;
  },

  // Separate, explicit flow from registering an ordinary payment — always
  // settles the FULL payoff quote, closing the loan out. Admin only.
  payoff: async (id: string): Promise<LoanDetail> => {
    const { data } = await apiClient.post<LoanDetail>(`/loans/${id}/payoff`);
    return data;
  },

  // Read-only, advisory — see docs/phases/PHASE_17_REFINANCING_RECALC.md.
  // The suggested figures are just a pre-fill; refinance() below still
  // accepts whatever principalAmount/concepts actually get submitted.
  getRefinanceQuote: async (id: string): Promise<RefinanceQuote> => {
    const { data } = await apiClient.get<RefinanceQuote>(
      `/loans/${id}/refinance-quote`,
    );
    return data;
  },

  // Admin only — enforced server-side. Returns the newly-created loan
  // (with its generated installments), not the old one — the caller
  // navigates there after a successful refinance.
  refinance: async (
    id: string,
    input: RefinanceLoanInput,
  ): Promise<LoanDetail> => {
    const { data } = await apiClient.post<LoanDetail>(
      `/loans/${id}/refinance`,
      input,
    );
    return data;
  },

  // Phase 30 — soft-deletes a loan created by mistake. Admin only; the api
  // rejects with a 409 (ApiError) if the loan already has at least one
  // registered payment on any installment — the caller is expected to
  // surface that message, not treat it as a generic failure.
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/loans/${id}`);
  },
};
