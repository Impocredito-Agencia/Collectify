import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { whatsappConversationTicketsApi } from '@/features/whatsappInboundMessages/whatsappConversationTicketsApi';
import { whatsappInboundMessagesApi } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';

import type { WhatsappInboundMessagesQueryParams } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';

export function useWhatsappInboundMessages(
  params: WhatsappInboundMessagesQueryParams,
) {
  return useQuery({
    queryKey: ['whatsappInboundMessages', params],
    queryFn: () => whatsappInboundMessagesApi.getAll(params),
  });
}

// Human report, 2026-09-19 — replies are now persisted server-side; this
// invalidates the fetched list on success so the sender's own view
// updates immediately, without waiting on the websocket round trip (which
// also fires, harmlessly re-invalidating the same key).
export function useReplyToInboundMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      phoneNumber,
      message,
    }: {
      phoneNumber: string;
      message: string;
    }) => whatsappInboundMessagesApi.reply(phoneNumber, message),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['whatsappManualReplies'] }),
  });
}

export function useManualReplies() {
  return useQuery({
    queryKey: ['whatsappManualReplies'],
    queryFn: whatsappInboundMessagesApi.getManualReplies,
  });
}

// Backs the "Responder"/"Cerrar conversación" gating on
// WhatsappInboundMessagesPage.tsx — see whatsappInboundMessagesApi.ts's
// ConversationMenu. `enabled: false` while no conversation is selected
// yet (phoneNumber === '').
export function useConversationState(phoneNumber: string) {
  return useQuery({
    queryKey: ['whatsappConversationState', phoneNumber],
    queryFn: () => whatsappInboundMessagesApi.getConversationState(phoneNumber),
    enabled: phoneNumber !== '',
  });
}

export function useCloseConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      phoneNumber,
      sendClosingMessage,
    }: {
      phoneNumber: string;
      sendClosingMessage?: boolean;
    }) =>
      whatsappInboundMessagesApi.closeConversation(
        phoneNumber,
        sendClosingMessage,
      ),
    onSuccess: (_data, { phoneNumber }) => {
      queryClient.invalidateQueries({
        queryKey: ['whatsappConversationState', phoneNumber],
      });
      // Human report, 2026-09-13 — closing IS resolving a ticket too; same
      // "don't wait on the socket round trip" reasoning as
      // useReplyToInboundMessage above.
      queryClient.invalidateQueries({
        queryKey: ['whatsappConversationTickets'],
      });
    },
  });
}

// Human report, 2026-09-13 — backs the "Mensajes entrantes" sidebar badge,
// the "Esperando asesor" filter, and the FIFO pinning in the inbox's
// conversation list. `enabled` defaults to true — pass false from a
// component (like Sidebar/AppLayout) that renders for every route,
// regardless of whether the current user was even granted the "messages"
// module, to avoid a pointless 403 on every page load.
export function useConversationTickets(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['whatsappConversationTickets'],
    queryFn: () => whatsappConversationTicketsApi.getAll(),
    enabled: options?.enabled ?? true,
  });
}
