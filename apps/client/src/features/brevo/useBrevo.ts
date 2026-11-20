import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { brevoApi } from '@/features/brevo/brevoApi';

export function useBrevoStatus() {
  return useQuery({
    queryKey: ['brevoStatus'],
    queryFn: brevoApi.getStatus,
  });
}

export function useSendBrevoTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: brevoApi.sendTest,
    // A sent SMS spends a credit — refresh the balance shown on the card.
    onSuccess: (result) => {
      if (result.sent) {
        void queryClient.invalidateQueries({ queryKey: ['brevoStatus'] });
      }
    },
  });
}
