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
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({
        queryKey: ['loans', loanId, 'payments'],
      });
    },
  });
}
