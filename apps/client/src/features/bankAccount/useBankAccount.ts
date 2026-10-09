import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bankAccountApi } from '@/features/bankAccount/bankAccountApi';

// Shared by the templates page's editor and the inbox's send dialog — a
// single query key means saving a new account updates the send preview
// too.
export function useBankAccount() {
  return useQuery({
    queryKey: ['bankAccount'],
    queryFn: bankAccountApi.get,
  });
}

export function useUpdateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bankAccountApi.update,
    onSuccess: (setting) => {
      queryClient.setQueryData(['bankAccount'], setting);
    },
  });
}
