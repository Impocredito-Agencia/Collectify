import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { loansApi } from '@/features/loans/loansApi';

import type {
  LoansQueryParams,
  RefinanceLoanInput,
  UpdateLoanInput,
} from '@/features/loans/loansApi';

// Not a useQuery — the admin triggers this on demand (a "Previsualizar
// cronograma" button), not automatically on every keystroke, so a mutation
// (imperative .mutateAsync call) fits better than a cached, key-driven query.
export function usePreviewSchedule() {
  return useMutation({ mutationFn: loansApi.previewSchedule });
}

export function useLoans(params: LoansQueryParams) {
  return useQuery({
    queryKey: ['loans', params],
    queryFn: () => loansApi.getAll(params),
    // Human report, 2026-09-27 — keeps the previous page on screen while a
    // new one loads instead of flashing "Cargando…" and losing the pager;
    // see useClients.ts's identical fix for the full explanation.
    placeholderData: keepPreviousData,
  });
}

// Style cleanup (2026-09-03) — suggested next #0000-style pagaré number,
// fetched automatically whenever LoanForm/RefinanceLoanForm mount (both
// only ever mount when actually needed, so no `enabled` guard required).
// A useQuery rather than a mutation like usePayoffQuote/useRefinanceQuote
// above — this isn't triggered by a button, it should just be there by
// the time the admin looks at the field.
export function useNextPromissoryNoteNumber() {
  return useQuery({
    queryKey: ['loans', 'next-promissory-note-number'],
    queryFn: loansApi.getNextPromissoryNoteNumber,
    // The suggestion only needs to reflect reality at the moment the form
    // opens — no need to refetch on window refocus etc. mid-fill, which
    // could otherwise yank the field out from under someone mid-edit.
    staleTime: Infinity,
  });
}

export function useLoan(id: string) {
  return useQuery({
    queryKey: ['loans', id],
    queryFn: () => loansApi.getOne(id),
    enabled: Boolean(id),
  });
}

export function useLoanPayments(id: string) {
  return useQuery({
    queryKey: ['loans', id, 'payments'],
    queryFn: () => loansApi.getPayments(id),
    enabled: Boolean(id),
  });
}

export function useCreateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: loansApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] }),
  });
}

export function useUpdateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLoanInput }) =>
      loansApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] }),
  });
}

// Human request, 2026-10-09 — the same payoff quote as usePayoffQuote
// below, but as a query: LoanDetailPage's "Si paga todo hoy" card shows it
// as soon as the page opens, no button involved. Keyed under ['loans', id]
// so every payment/edit that already invalidates the loan refreshes this
// figure too.
export function useLoanPayoffQuote(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['loans', id, 'payoff-quote'],
    queryFn: () => loansApi.getPayoffQuote(id),
    enabled: enabled && Boolean(id),
  });
}

// Not a useQuery — fetched on demand when the "Liquidar anticipadamente"
// dialog opens (via .mutateAsync), same pattern as usePreviewSchedule.
export function usePayoffQuote() {
  return useMutation({ mutationFn: loansApi.getPayoffQuote });
}

// Not a useQuery — fetched on demand when RefinanceLoanForm opens (via
// .mutateAsync), same pattern as usePreviewSchedule/usePayoffQuote.
export function useRefinanceQuote() {
  return useMutation({ mutationFn: loansApi.getRefinanceQuote });
}

export function usePayoffLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, imageUrls }: { id: string; imageUrls?: string[] }) =>
      loansApi.payoff(id, { imageUrls }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] }),
  });
}

export function useRefinanceLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RefinanceLoanInput }) =>
      loansApi.refinance(id, input),
    // Invalidates every loan query — this mutates two loans at once (old
    // loan's status/installments, new loan created), so a targeted
    // invalidation isn't worth the complexity.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] }),
  });
}

export function useRemoveLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: loansApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] }),
  });
}

// Human report, 2026-09-22 — bulk due-date reschedule ("que queden todas
// el 10"). Same invalidation shape as useUpdateLoan — this loan's own
// detail query embeds the installments that just moved.
export function useAlignInstallmentDueDay(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dayOfMonth: number) =>
      loansApi.alignInstallmentDueDay(loanId, dayOfMonth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

// Human request, 2026-09-25 — silent cuota correction on an unlocked
// pagaré. Same invalidation shape as useAlignInstallmentDueDay.
export function useAdjustPendingInstallments(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (amountPerInstallment: number) =>
      loansApi.adjustPendingInstallments(loanId, amountPerInstallment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}
