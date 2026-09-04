import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { interestConceptTypesApi } from '@/features/interestConceptTypes/interestConceptTypesApi';

import type {
  InterestConceptTypesQueryParams,
  UpdateInterestConceptTypeInput,
} from '@/features/interestConceptTypes/interestConceptTypesApi';

export function useInterestConceptTypes(
  params: InterestConceptTypesQueryParams = {},
) {
  return useQuery({
    queryKey: ['interestConceptTypes', params],
    queryFn: () => interestConceptTypesApi.getAll(params),
  });
}

export function useCreateInterestConceptType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: interestConceptTypesApi.create,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['interestConceptTypes'] }),
  });
}

export function useUpdateInterestConceptType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateInterestConceptTypeInput;
    }) => interestConceptTypesApi.update(id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['interestConceptTypes'] }),
  });
}

export function useDeactivateInterestConceptType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: interestConceptTypesApi.deactivate,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['interestConceptTypes'] }),
  });
}

export function useDeleteInterestConceptType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: interestConceptTypesApi.remove,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['interestConceptTypes'] }),
  });
}
