import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { loanDeletionApi } from '@/features/loans/loanDeletionApi';

import type {
  DeleteLoanInput,
  DeletedLoansQueryParams,
} from '@/features/loans/loanDeletionApi';

// Phase 35 — fetched fresh every time the deletion dialog opens
// (staleTime 0, refetched on mount): what it shows, and the number it asks
// to type, must reflect the loan right now, not a cached earlier read.
export function useLoanDeletionPreview(id: string) {
  return useQuery({
    queryKey: ['loans', id, 'deletion-preview'],
    queryFn: () => loanDeletionApi.getPreview(id),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

// Invalidates ['clients'] too — a client's figures (loans count, cupo,
// saldo a favor) change once one of their pagarés is deleted.
export function useDeleteLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DeleteLoanInput }) =>
      loanDeletionApi.remove(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useDeletedLoans(params: DeletedLoansQueryParams) {
  return useQuery({
    queryKey: ['loans', 'deleted', params],
    queryFn: () => loanDeletionApi.getAll(params),
  });
}

export function useDeletedLoan(id: string) {
  return useQuery({
    queryKey: ['loans', 'deleted', id],
    queryFn: () => loanDeletionApi.getOne(id),
    enabled: Boolean(id),
  });
}
