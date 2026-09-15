import { apiClient } from '@/lib/apiClient';

import type {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';

// Matches apps/api/src/loans/entities/installment.entity.ts exactly.
export enum InstallmentStatus {
  Pending = 'pending',
  Paid = 'paid',
  Cancelled = 'cancelled',
}

// Matches apps/api/src/loans/installments/enrichInstallment.ts's
// ConceptBreakdownItem exactly. Phase 23 unified corriente (stored, real
// amount) and moratorio (computed live once overdue, 0 otherwise) items
// into this one array, tagged by category, so the dynamic charge table can
// render both together.
export interface ConceptBreakdownItem {
  name: string;
  amount: number;
  category: ConceptCategory;
  // Added 2026-09-06 (client request — no visual way to tell what rate a
  // given pagaré was actually made at, since two pagarés could legitimately
  // differ as the usury ceiling moves month to month, and the currency
  // amount alone doesn't reveal it). The % (Percentage) or flat figure
  // (FixedAmount) actually applied for this charge — constant across every
  // cuota of the same loan (only the resulting `amount` changes cuota to
  // cuota), so LoanDetailPage shows it once, in the column header, rather
  // than repeating it on every row. Optional: PayoffQuote reuses this same
  // shape for a corriente line item with no rate to attach — see the
  // backend's identical comment on this field.
  value?: number;
  calculationType?: ConceptCalculationType;
}

// Matches apps/api/src/loans/installments/enrichInstallment.ts's
// InstallmentWithCalculated exactly. overdueDays/interest/totalDue are
// calculated on read by the API, NEVER on the client — Phase 4's explicit
// rule (docs/phasesClient/PHASE_4_LOANS_INSTALLMENTS.md). They come back as
// 0 for any non-pending installment (paid or cancelled), per the API's own
// enrichInstallment logic — not a special case to handle here.
// principalPortion/conceptBreakdown were added in Phase 14 — both were
// computed once at schedule-generation time and are read back as stored,
// unlike overdueDays/interest/totalDue. principalPortion is null for
// installments generated before Phase 14 shipped.
export interface Installment {
  id: string;
  loanId: string;
  installmentNumber: number;
  amount: number;
  principalPortion: number | null;
  dueDate: string;
  status: InstallmentStatus;
  // Redesign, 2026-09-03 — true only for the loan's own down payment
  // ("cuota inicial"), always installmentNumber 1 when present: a real,
  // interest-free installment with its own due date. See
  // docs/phases/PHASE_13_INITIAL_INSTALLMENT.md for the superseded,
  // purely-informational model this replaces.
  isDownPayment: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  overdueDays: number;
  interest: number;
  totalDue: number;
  conceptBreakdown: ConceptBreakdownItem[];
}

export interface InstallmentsQueryParams {
  loanId?: string;
  status?: InstallmentStatus;
  // Only pending installments past their due date — server-side filter,
  // not derived client-side.
  overdueOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface PaginatedInstallments {
  items: Installment[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Matches apps/api/src/loans/installments/dto/createPayment.dto.ts exactly.
// imageUrls (Phase 12, widened to an array in Phase 28) are already-hosted
// receipt photo URLs — the api only stores them, it never receives the
// files themselves. See lib/imageUpload.ts for how each URL is obtained
// before this is called.
export interface CreatePaymentInput {
  amountPaid: number;
  paidAt: string;
  observation?: string;
  imageUrls?: string[];
  // Human report, 2026-09-11 — set by RegisterPaymentFromWhatsappModal so
  // the api can link this payment back to the WhatsApp comprobante it was
  // reviewed from — see whatsappInboundMessagesApi.ts's WhatsappInboundMessage.payment.
  sourceWhatsappMessageId?: string;
}

// Matches apps/api/src/loans/installments/dto/registerBulkPayments.dto.ts.
// Same shape as CreatePaymentInput, just tagged with which installment it
// applies to — the amount is entered individually per installment, never
// split from a single total (confirmed with the client).
export interface BulkPaymentEntryInput extends CreatePaymentInput {
  installmentId: string;
}

// Matches apps/api/src/loans/loans.service.ts's PaymentWithImages exactly.
// Note: registering a payment returns only this raw Payment row — NOT the
// updated installment or loan. The caller (useRegisterPayment) must
// invalidate the loan-detail query itself to see the installment's new
// status reflected.
export interface Payment {
  id: string;
  installmentId: string;
  amountPaid: number;
  paidAt: string;
  observation: string | null;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
  // Human report, 2026-09-09 — a voided payment (see
  // apps/api/src/loans/installments/installments.service.ts's
  // voidPayment()) has deletedAt/voidReason set but otherwise stays a
  // normal row — GET /loans/:id/payments deliberately still returns it
  // (withDeleted: true), so the loan detail's payment history can show it
  // as anulado instead of it silently vanishing.
  deletedAt: string | null;
  voidReason: string | null;
  // Human report, 2026-09-14 — true only for a payment created by applying
  // a client's saldo a favor (see ClientCreditBanner.tsx), not an ordinary
  // cash/transfer payment.
  fundedByCredit: boolean;
}

export const installmentsApi = {
  getAll: async (
    params: InstallmentsQueryParams = {},
  ): Promise<PaginatedInstallments> => {
    const { data, meta } = await apiClient.get<Installment[]>('/installments', {
      loanId: params.loanId,
      status: params.status,
      overdueOnly: params.overdueOnly,
      page: params.page,
      limit: params.limit,
    });
    return { items: data, meta: meta as PaginatedInstallments['meta'] };
  },

  registerPayment: async (
    installmentId: string,
    input: CreatePaymentInput,
  ): Promise<Payment> => {
    const { data } = await apiClient.post<Payment>(
      `/installments/${installmentId}/payments`,
      input,
    );
    return data;
  },

  // Phase 28 — pays several installments in one action; the api requires
  // full payment of every entry (BadRequestException otherwise) and rolls
  // back the whole batch on any failure, see
  // InstallmentsService.registerBulkPayments.
  registerBulkPayments: async (
    payments: BulkPaymentEntryInput[],
  ): Promise<Payment[]> => {
    const { data } = await apiClient.post<Payment[]>(
      '/installments/payments/bulk',
      { payments },
    );
    return data;
  },

  // Human report, 2026-09-09 — admin-only correction for a payment
  // registered by mistake. See InstallmentsService.voidPayment().
  voidPayment: async (paymentId: string, reason: string): Promise<Payment> => {
    const { data } = await apiClient.patch<Payment>(
      `/installments/payments/${paymentId}/void`,
      { reason },
    );
    return data;
  },

  // Human report, 2026-09-14 — the explicit, operator-initiated half of
  // saldo a favor. See ClientCreditBanner.tsx and
  // InstallmentsService.applyCreditToInstallment.
  applyCredit: async (
    installmentId: string,
    clientId: string,
    amount: number,
  ): Promise<Payment> => {
    const { data } = await apiClient.post<Payment>(
      `/installments/${installmentId}/apply-credit`,
      { clientId, amount },
    );
    return data;
  },
};
