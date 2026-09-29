import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { clientsApi } from '@/features/clients/clientsApi';

import type {
  ClientsQueryParams,
  CreateClientReferenceInput,
  UpdateClientInput,
  UpdateClientReferenceInput,
} from '@/features/clients/clientsApi';

export function useClients(
  params: ClientsQueryParams,
  // The global default (queryClient.ts) is refetchOnWindowFocus: false and
  // staleTime: 30s — deliberate, to avoid noisy background refetches
  // app-wide. Opt-in only, per call site: the codeudor picker in
  // LoanForm.tsx/RefinanceLoanForm.tsx passes both true/0 so results
  // refresh automatically when the admin comes back from creating a
  // client in a new tab, without needing to retype the search — staleTime
  // 0 matters here specifically because refetchOnWindowFocus is a no-op
  // while data is still considered fresh under the global 30s window. See
  // docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md.
  options?: { refetchOnWindowFocus?: boolean; staleTime?: number },
) {
  return useQuery({
    queryKey: ['clients', params],
    queryFn: () => clientsApi.getAll(params),
    // Human report, 2026-09-27 — sorting/paging/searching changes the query
    // key, and without this, react-query drops `data` to undefined for the
    // moment the new key has no cache yet: the table flips to "Cargando…",
    // "Mostrando X de Y"/the pager disappear (both read off `meta`, itself
    // part of `data`), and the header snaps back up — then everything
    // reflows again once the real page lands. Keeping the previous page's
    // rows on screen during that gap (`isFetching` still tells the caller a
    // fetch is in flight, if a subtler "refreshing" indicator is ever
    // wanted) removes the flash entirely. Same fix applied to every other
    // paginated table's query — see useLoans/useAuditLogs/useMessageLogs/
    // useOverdueClients.
    placeholderData: keepPreviousData,
    // Spread conditionally, not `refetchOnWindowFocus: options?.x` directly
    // — react-query's defaultQueryOptions shallow-merges this object over
    // queryClient.ts's app-wide defaults, so an explicit `undefined` key
    // here would overwrite (not "inherit") those defaults for every other
    // call site that doesn't pass options at all.
    ...(options?.refetchOnWindowFocus !== undefined && {
      refetchOnWindowFocus: options.refetchOnWindowFocus,
    }),
    ...(options?.staleTime !== undefined && { staleTime: options.staleTime }),
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: ['clients', id],
    queryFn: () => clientsApi.getOne(id),
    enabled: Boolean(id),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateClientInput }) =>
      clientsApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clientsApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useReactivateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clientsApi.reactivate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}

// Phase 21 — references sub-resource. Each mutation invalidates
// ['clients', clientId] (the ClientDetail query, which is what carries
// `references`) rather than the whole ['clients'] list — the list view
// (Client, not ClientDetail) never shows references, so there's no need to
// refetch it here.
export function useAddClientReference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      input,
    }: {
      clientId: string;
      input: CreateClientReferenceInput;
    }) => clientsApi.addReference(clientId, input),
    onSuccess: (_data, { clientId }) =>
      queryClient.invalidateQueries({ queryKey: ['clients', clientId] }),
  });
}

export function useUpdateClientReference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      referenceId,
      input,
    }: {
      clientId: string;
      referenceId: string;
      input: UpdateClientReferenceInput;
    }) => clientsApi.updateReference(clientId, referenceId, input),
    onSuccess: (_data, { clientId }) =>
      queryClient.invalidateQueries({ queryKey: ['clients', clientId] }),
  });
}

export function useRemoveClientReference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      referenceId,
    }: {
      clientId: string;
      referenceId: string;
    }) => clientsApi.removeReference(clientId, referenceId),
    onSuccess: (_data, { clientId }) =>
      queryClient.invalidateQueries({ queryKey: ['clients', clientId] }),
  });
}

// Phase 27 — message frequency whitelist. Both invalidate the ClientDetail
// query (['clients', clientId]), which is what carries messageFrequency —
// same pattern as the reference mutations above.
export function useSetClientMessageFrequency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      minimumDaysBetweenMessages,
    }: {
      clientId: string;
      minimumDaysBetweenMessages: number;
    }) => clientsApi.setMessageFrequency(clientId, minimumDaysBetweenMessages),
    onSuccess: (_data, { clientId }) =>
      queryClient.invalidateQueries({ queryKey: ['clients', clientId] }),
  });
}

export function useClearClientMessageFrequency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      clientsApi.clearMessageFrequency(clientId),
    onSuccess: (_data, clientId) =>
      queryClient.invalidateQueries({ queryKey: ['clients', clientId] }),
  });
}

// Human report, 2026-09-23 — per-number "desactivar mensajes".
export function useSetClientMutedPhoneNumbers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      phoneNumbers,
    }: {
      clientId: string;
      phoneNumbers: string[];
    }) => clientsApi.setMutedPhoneNumbers(clientId, phoneNumbers),
    onSuccess: (_data, { clientId }) =>
      queryClient.invalidateQueries({ queryKey: ['clients', clientId] }),
  });
}

// Human report, 2026-09-14 — see ClientCreditBanner.tsx. Own query key
// (not folded into ['clients', clientId], which carries the heavier
// ClientDetail payload) so the banner can poll/invalidate this alone after
// applying credit, without re-fetching the whole client.
export function useClientCreditBalance(clientId: string) {
  return useQuery({
    queryKey: ['clients', clientId, 'credit-balance'],
    queryFn: () => clientsApi.getCreditBalance(clientId),
    enabled: clientId !== '',
  });
}

// Human request, 2026-09-26 — see RefundClientCreditDialog.tsx.
export function useRefundClientCredit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      amount,
      reason,
    }: {
      clientId: string;
      amount: number;
      reason?: string;
    }) => clientsApi.refundCredit(clientId, { amount, reason }),
    onSuccess: (_data, { clientId }) =>
      queryClient.invalidateQueries({
        queryKey: ['clients', clientId, 'credit-balance'],
      }),
  });
}

// Human request, 2026-09-15 — see ClientAccountStatusPanel.tsx. Own query
// key for the same reason useClientCreditBalance's does: this can go stale
// the moment a payment is registered against one of the client's
// installments, so it's invalidated independently of the heavier
// ClientDetail payload.
export function useClientAccountStatus(clientId: string) {
  return useQuery({
    queryKey: ['clients', clientId, 'account-status'],
    queryFn: () => clientsApi.getAccountStatus(clientId),
    enabled: clientId !== '',
  });
}
