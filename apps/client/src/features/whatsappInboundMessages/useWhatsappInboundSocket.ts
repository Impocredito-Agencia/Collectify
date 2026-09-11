import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { connectNamespace } from '@/lib/socket';

// Pushes a live update into the "Mensajes entrantes" inbox — see
// docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md. Invalidates rather than
// merging the pushed message directly into the cache, matching this
// project's existing pattern (useRetryMessageLog) for "something changed,
// refetch" instead of hand-rolled cache surgery.
export function useWhatsappInboundSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = connectNamespace('whatsapp-inbound');

    socket.on('inbound-message', () => {
      void queryClient.invalidateQueries({
        queryKey: ['whatsappInboundMessages'],
      });
      // A new inbound event can flip a phone number's self-service-menu
      // state (e.g. a receipt arriving moves it to handed_off_to_human) —
      // keep the "Responder"/"Cerrar conversación" gating live too.
      void queryClient.invalidateQueries({
        queryKey: ['whatsappConversationState'],
      });
    });

    // Human report, 2026-09-19 — an admin's manual reply now persists and
    // pushes live, same as an inbound client message, so every OTHER
    // connected admin sees it immediately too.
    socket.on('manual-reply', () => {
      void queryClient.invalidateQueries({
        queryKey: ['whatsappManualReplies'],
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);
}
