import { apiClient } from '@/lib/apiClient';

import type { Payment } from '@/features/installments/installmentsApi';
import type {
  InstallmentFrequency,
  LoanStatus,
} from '@/features/loans/loansApi';

// Phase 35 — irreversible loan deletion and the read-only view of deleted
// pagarés. See docs/phasesClient/PHASE_35_LOAN_DELETION.md.

// Matches apps/api/src/loans/deletion/loanDeletion.service.ts's
// LoanDeletionPreview exactly.
export interface LoanDeletionPreview {
  loanId: string;
  // The CURRENT number — the one to type to confirm. Always read from
  // here, never from the page's cached loan, so a renumber done elsewhere
  // is already reflected.
  promissoryNoteNumber: string;
  clientId: string;
  clientFullName: string;
  chainLoans: { id: string; promissoryNoteNumber: string }[];
  installmentCount: number;
  paymentCount: number;
  paymentsTotal: number;
  creditToRestore: number;
  creditToReverse: number;
  // Spanish, ready to show; empty means it can be deleted.
  blockers: string[];
}

// Matches apps/api/src/loans/deletion/dto/deleteLoan.dto.ts exactly.
export interface DeleteLoanInput {
  reason: string;
  confirmPromissoryNoteNumber: string;
}

// Matches deletedLoans.service.ts's DeletedLoanSummary exactly.
export interface DeletedLoanSummary {
  id: string;
  promissoryNoteNumber: string;
  clientId: string;
  clientFullName: string;
  principalAmount: number;
  totalInstallments: number;
  status: LoanStatus;
  deletedAt: string;
  // Null for a pagaré deleted before Phase 35 (no reason/author recorded).
  deletedByFullName: string | null;
  deletionReason: string | null;
  // In the list: true when any loan of its refinance chain had one.
  hadPayments: boolean;
  // The earlier loans of its refinance chain, deleted with it, newest
  // first. The list shows a whole chain as this one row.
  refinancedLoans: { id: string; promissoryNoteNumber: string }[];
}

// Matches loanDeletionSnapshot.ts's DeletedInstallmentSnapshot exactly.
export interface DeletedInstallment {
  installmentNumber: number;
  isDownPayment: boolean;
  dueDate: string;
  amount: number;
  principalPortion: number | null;
  status: string;
  overdueDays: number;
  interest: number;
  totalPaid: number;
  totalDue: number;
  conceptBreakdown: { name: string; category: string; amount: number }[];
}

// Matches deletedLoans.service.ts's DeletedLoanDetail exactly.
export interface DeletedLoanDetail extends DeletedLoanSummary {
  clientDocumentNumber: string | null;
  disbursedAt: string;
  installmentFrequency: InstallmentFrequency;
  description: string | null;
  installments: DeletedInstallment[];
  // False for a pre-Phase 35 deletion: cuotas come without mora.
  hasFrozenFigures: boolean;
  payments: Payment[];
  deletedTogether: { id: string; promissoryNoteNumber: string }[];
}

export interface DeletedLoansQueryParams {
  clientId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedDeletedLoans {
  items: DeletedLoanSummary[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const loanDeletionApi = {
  // Admin only.
  getPreview: async (id: string): Promise<LoanDeletionPreview> => {
    const { data } = await apiClient.get<LoanDeletionPreview>(
      `/loans/${id}/deletion-preview`,
    );
    return data;
  },

  // Admin only. IRREVERSIBLE. Rejects with 400 (missing reason / typed
  // number isn't the current one) or 409 (a blocker appeared since the
  // preview) — both carry a Spanish message meant to be shown as-is.
  remove: async (id: string, input: DeleteLoanInput): Promise<void> => {
    await apiClient.delete(`/loans/${id}`, input);
  },

  getAll: async (
    params: DeletedLoansQueryParams = {},
  ): Promise<PaginatedDeletedLoans> => {
    const { data, meta } = await apiClient.get<DeletedLoanSummary[]>(
      '/loans/deleted',
      {
        clientId: params.clientId,
        search: params.search,
        page: params.page,
        limit: params.limit,
      },
    );
    return {
      items: data,
      meta: meta as PaginatedDeletedLoans['meta'],
    };
  },

  getOne: async (id: string): Promise<DeletedLoanDetail> => {
    const { data } = await apiClient.get<DeletedLoanDetail>(
      `/loans/deleted/${id}`,
    );
    return data;
  },
};
