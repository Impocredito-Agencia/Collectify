import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { whatsappConversationTicketsApi } from '@/features/whatsappInboundMessages/whatsappConversationTicketsApi';
import { whatsappConversationsApi } from '@/features/whatsappInboundMessages/whatsappConversationsApi';
import { whatsappDeliveryHealthApi } from '@/features/whatsappInboundMessages/whatsappDeliveryHealthApi';
import { whatsappInboundMessagesApi } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';

import type { WhatsappConversationsQueryParams } from '@/features/whatsappInboundMessages/whatsappConversationsApi';
import type { WhatsappInboundMessagesQueryParams } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';

export function useWhatsappInboundMessages(
  params: WhatsappInboundMessagesQueryParams,
) {
  return useQuery({
    queryKey: ['whatsappInboundMessages', params],
    queryFn: () => whatsappInboundMessagesApi.getAll(params),
  });
}

// Human report, 2026-09-14 (critical bug) — drives the inbox's "Todos" tab.
// Paginated by CONVERSATION server-side (see whatsappConversationsApi's own
// comment), replacing the old client-side grouping of a flat, globally-
// capped message fetch.
export function useConversations(params: WhatsappConversationsQueryParams) {
  return useQuery({
    queryKey: ['whatsappConversations', params],
    queryFn: () => whatsappConversationsApi.getAll(params),
  });
}

// Backs the "Esperando asesor" tab — exactly the pending tickets' own
// conversations, regardless of how long ago they last messaged. `enabled`
// guards against firing with an empty array (nothing to fetch) or before
// the ticket list itself has loaded.
export function useConversationsForClientIds(clientIds: string[]) {
  return useQuery({
    queryKey: ['whatsappConversations', 'byClientIds', clientIds],
    queryFn: () => whatsappConversationsApi.getForClientIds(clientIds),
    enabled: clientIds.length > 0,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsappManualReplies'] });
      // Human report, 2026-09-23 — replying makes this the most recent
      // conversation, so the list re-sorts it to the top right away.
      queryClient.invalidateQueries({ queryKey: ['whatsappConversations'] });
    },
  });
}

// Human report, 2026-09-24 — same cache refresh as a manual reply: the
// template shows up in the thread and moves the chat to the top.
export function useSendFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phoneNumber: string) =>
      whatsappInboundMessagesApi.sendFollowUp(phoneNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsappManualReplies'] });
      queryClient.invalidateQueries({ queryKey: ['whatsappConversations'] });
    },
  });
}

// Human request, 2026-10-09 — same cache refresh as useSendFollowUp.
export function useSendBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phoneNumber: string) =>
      whatsappInboundMessagesApi.sendBankAccount(phoneNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsappManualReplies'] });
      queryClient.invalidateQueries({ queryKey: ['whatsappConversations'] });
    },
  });
}

// Human report, 2026-09-14 (critical bug) — scoped to one conversation now
// (clientId, or fromPhoneNumber for an unrecognized number), same "shared
// global budget" bug fix as useConversations above: a busy conversation's
// own replies used to be able to push another conversation's replies out
// of one flat, cross-conversation window. `enabled` guards against firing
// before a conversation is selected.
export function useManualReplies(params: {
  clientId: string | null;
  fromPhoneNumber: string;
}) {
  return useQuery({
    queryKey: ['whatsappManualReplies', params],
    queryFn: () =>
      whatsappInboundMessagesApi.getManualReplies(
        params.clientId
          ? { clientId: params.clientId }
          : { fromPhoneNumber: params.fromPhoneNumber },
      ),
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
    onSuccess: () => {
      // Human report, 2026-09-23 — closing now also turns the chat green
      // in the list (closedAt), not only via its ticket.
      queryClient.invalidateQueries({
        queryKey: ['whatsappConversations'],
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

// Human report, 2026-09-16 — "¿cómo sabemos si un cliente nos bloqueó?".
// `enabled: false` while no known client is selected (an unrecognized-
// number conversation has no clientId to look this up by).
export function useDeliveryHealth(clientId: string | null) {
  return useQuery({
    queryKey: ['whatsappDeliveryHealth', clientId],
    queryFn: () => whatsappDeliveryHealthApi.getForClient(clientId as string),
    enabled: clientId !== null,
  });
}
