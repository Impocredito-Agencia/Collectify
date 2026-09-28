import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { messageLogsApi } from '@/features/messageLogs/messageLogsApi';

import type { MessageLogsQueryParams } from '@/features/messageLogs/messageLogsApi';

export function useMessageLogs(params: MessageLogsQueryParams) {
  return useQuery({
    queryKey: ['messageLogs', params],
    queryFn: () => messageLogsApi.getAll(params),
    // Human report, 2026-09-27 — keeps the previous page on screen while a
    // new one loads instead of flashing "Cargando…" and losing the pager;
    // see useClients.ts's identical fix for the full explanation.
    placeholderData: keepPreviousData,
  });
}

export function useMessageLogItems(id: string | null) {
  return useQuery({
    queryKey: ['messageLogs', id, 'items'],
    queryFn: () => messageLogsApi.getItems(id ?? ''),
    enabled: Boolean(id),
  });
}

// Human report, 2026-09-19 — backs the automated-message bubbles on
// WhatsappInboundMessagesPage.tsx's conversation thread: a client tapping
// "Ya pagué" after a reminder made no sense in the inbox without the
// reminder itself alongside it. Disabled (not just clientId: '') for an
// unrecognized-number conversation, which has no clientId at all — GET
// /message-logs's clientId filter is validated as a UUID, so an empty
// string would 400 rather than just returning nothing.
export function useMessageLogsForClient(clientId: string | null) {
  return useQuery({
    queryKey: ['messageLogs', 'client', clientId],
    queryFn: () =>
      messageLogsApi.getAll({ clientId: clientId ?? '', limit: 100 }),
    enabled: Boolean(clientId),
  });
}

// Phase 18 — retrying creates a new MessageLog row and stamps retriedAt on
// the original, so the whole list needs refetching either way.
export function useRetryMessageLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: messageLogsApi.retry,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['messageLogs'] }),
  });
}
