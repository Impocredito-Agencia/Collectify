import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { installmentsApi } from '@/features/installments/installmentsApi';

import type {
  BulkPaymentEntryInput,
  CreatePaymentInput,
  InstallmentsQueryParams,
} from '@/features/installments/installmentsApi';

export function useInstallments(params: InstallmentsQueryParams) {
  return useQuery({
    queryKey: ['installments', params],
    queryFn: () => installmentsApi.getAll(params),
  });
}

// Registering a payment only returns the raw Payment row (see
// installmentsApi.ts) — the installment/loan's new status comes from
// re-fetching, so this invalidates both the installments list AND the
// parent loan detail (['loans', loanId]) that embeds this installment.
// loanId is passed in explicitly since the payment response alone doesn't
// carry enough to know which loan to invalidate.
export function useRegisterPayment(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      installmentId,
      input,
    }: {
      installmentId: string;
      input: CreatePaymentInput;
    }) => installmentsApi.registerPayment(installmentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({
        queryKey: ['loans', loanId, 'payments'],
      });
    },
  });
}

// Same invalidation as useRegisterPayment above — one bulk request can
// flip several of this loan's installments to Paid at once.
export function useRegisterBulkPayments(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payments: BulkPaymentEntryInput[]) =>
      installmentsApi.registerBulkPayments(payments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({
        queryKey: ['loans', loanId, 'payments'],
      });
    },
  });
}

// Human report, 2026-09-09 — admin-only correction for a payment
// registered by mistake. Same invalidation as the two hooks above:
// voiding can reopen the installment (and the loan, if it had cascaded to
// Paid), so both need re-fetching alongside the payments list itself.
export function useVoidPayment(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      paymentId,
      reason,
    }: {
      paymentId: string;
      reason: string;
    }) => installmentsApi.voidPayment(paymentId, reason),
    onSuccess: () => {
      // Voiding can take back or give back saldo a favor (2026-09-26), so the
      // client's credit balance can change too.
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({
        queryKey: ['loans', loanId, 'payments'],
      });
    },
  });
}

// Human report, 2026-09-14 — the explicit, operator-initiated half of
// saldo a favor (ClientCreditBanner.tsx). The destination installment can
// belong to ANY of the client's loans (confirmed with the human), so
// loanId is passed in at call time (from whichever cuota was picked)
// rather than curried like the hooks above — this invalidates that
// specific loan plus the credit balance itself, which is what drives the
// banner disappearing once it hits $0.
export function useApplyClientCredit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      installmentId,
      clientId,
      amount,
    }: {
      installmentId: string;
      clientId: string;
      amount: number;
      loanId: string;
    }) => installmentsApi.applyCredit(installmentId, clientId, amount),
    onSuccess: (_data, { clientId, loanId }) => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({
        queryKey: ['loans', loanId, 'payments'],
      });
      queryClient.invalidateQueries({
        queryKey: ['clients', clientId, 'credit-balance'],
      });
    },
  });
}

// Human report, 2026-09-22 — moves a single pending installment's due
// date. Same invalidation shape as useRegisterPayment/useVoidPayment
// above — loanId is curried since this is only ever called from
// LoanDetailPage's own installments table.
export function useUpdateInstallmentDueDate(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      installmentId,
      dueDate,
    }: {
      installmentId: string;
      dueDate: string;
    }) => installmentsApi.updateDueDate(installmentId, dueDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
    },
  });
}
