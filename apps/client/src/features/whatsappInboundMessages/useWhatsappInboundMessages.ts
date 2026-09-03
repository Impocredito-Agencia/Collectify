import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export function useReplyToInboundMessage() {
  return useMutation({
    mutationFn: ({
      phoneNumber,
      message,
    }: {
      phoneNumber: string;
      message: string;
    }) => whatsappInboundMessagesApi.reply(phoneNumber, message),
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
    mutationFn: (phoneNumber: string) =>
      whatsappInboundMessagesApi.closeConversation(phoneNumber),
    onSuccess: (_data, phoneNumber) =>
      queryClient.invalidateQueries({
        queryKey: ['whatsappConversationState', phoneNumber],
      }),
  });
}
